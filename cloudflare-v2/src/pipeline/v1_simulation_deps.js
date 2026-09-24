import { accountSymbolCatalogFromProviderConfig, resolveAccountSymbol } from '../execution/account_symbol_catalog.js';
import { decryptConnectionCredentials } from '../security/connection_credentials.js';
import { CTraderJsonSession } from '../adapters/ctrader_session.js';
import { CTraderMarketData } from '../adapters/ctrader_market_data.js';
import { ctraderEndpoint } from '../adapters/ctrader_protocol.js';
import { providerFeedIdFromEvent } from '../sources/source_feed_store.js';
import { evaluateRouteFilters } from '../destinations/route_filters.js';
import { selectAuthorizedRoutesForFeed } from '../routes/logical_route_scope.js';
import { buildSymbolEquivalentSizing, buildBalancePercentSizing } from '../execution/margin_equivalent_sizing.js';

function parseJsonConfig(value, label) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function internalHeaders(env) {
  const token = String(env?.TRADE_STATE_INTERNAL_TOKEN || '');
  if (!token) throw new Error('TRADE_STATE_INTERNAL_TOKEN is not configured');
  return { 'content-type': 'application/json', 'x-mkety-internal-token': token };
}

function createTradeStateClient(env, workspaceId) {
  const namespace = env?.TRADE_STATE_NAMESPACE;
  if (!namespace?.idFromName || !namespace?.get) throw new Error('TRADE_STATE_NAMESPACE is not configured');
  const stub = namespace.get(namespace.idFromName(String(workspaceId)));
  const headers = { ...internalHeaders(env), 'x-mkety-workspace-id': String(workspaceId) };

  async function call(path, method, payload) {
    const response = await stub.fetch(`https://trade-state.internal${path}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Trade State request failed (${response.status}): ${body?.error || 'unknown error'}`);
    return body;
  }

  return {
    stateCoordinator: {
      correlate: (event, interpretation, nowMs) => call('/correlate', 'POST', { event, interpretation, nowMs }),
    },
    stateStore: {
      getGroup: (groupId) => call(`/groups/${encodeURIComponent(String(groupId))}`, 'GET'),
      putGroup: (group) => call('/groups', 'POST', group),
    },
  };
}

function canonicalSymbol(intent = {}) {
  return String(intent?.symbol?.canonical || intent?.symbol || '').toUpperCase();
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? '').trim();
}

function providerConfigOf(account = {}) {
  const config = account?.provider_config ?? account?.providerConfig;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function lotSizingConfigOf(account = {}) {
  const config = account?.lot_sizing_config ?? account?.lotSizingConfig;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function lotInstrumentFromResolved(resolvedSymbol = {}, fallbackLot = 0.01) {
  const minLots = Number(resolvedSymbol.minLots ?? resolvedSymbol.minVolume);
  const maxLots = Number(resolvedSymbol.maxLots ?? resolvedSymbol.maxVolume);
  const stepLots = Number(resolvedSymbol.stepLots ?? resolvedSymbol.stepVolume);
  return {
    minLots: Number.isFinite(minLots) && minLots > 0 ? minLots : Number(fallbackLot),
    maxLots: Number.isFinite(maxLots) && maxLots > 0 ? maxLots : Number(fallbackLot),
    stepLots: Number.isFinite(stepLots) && stepLots > 0 ? stepLots : Number(fallbackLot),
  };
}

function cTraderProtocolVolumeForLots(symbol = {}, lots) {
  const protocolLotSize = Number(symbol.protocolLotSize);
  const value = Number(lots);
  if (!(protocolLotSize > 0) || !(value > 0)) throw new Error('cTrader lot-size metadata unavailable');
  const protocolVolume = Math.round(value * protocolLotSize);
  if (!(protocolVolume > 0)) throw new Error('cTrader protocol volume unavailable');
  return protocolVolume;
}

async function cTraderMarginForLots(marketData, symbol, lots, side) {
  const rows = await marketData.expectedMargins(Number(symbol.platformId), [cTraderProtocolVolumeForLots(symbol, lots)]);
  const row = rows[0];
  if (!row) throw new Error('cTrader expected margin unavailable');
  const margin = String(side || '').toUpperCase() === 'SELL' ? Number(row.sellMargin) : Number(row.buyMargin);
  if (!(Number.isFinite(margin) && margin >= 0)) throw new Error('cTrader expected margin unavailable');
  return margin;
}


function isCTraderOauthAccount(account = {}) {
  return text(account?.platform).toLowerCase() === 'ctrader'
    && text(account?.provider_mode ?? account?.providerMode).toLowerCase() === 'ctrader_oauth';
}

function isMt5ConnectorAccount(account = {}) {
  return text(account?.platform).toLowerCase() === 'mt5'
    && text(account?.provider_mode ?? account?.providerMode).toLowerCase() === 'mt5_connector';
}

function executionSidePrice(intent = {}, tick = {}) {
  const side = text(intent?.side).toUpperCase();
  const preferred = side === 'BUY' ? tick.ask : side === 'SELL' ? tick.bid : null;
  for (const value of [preferred, tick.last, tick.ask, tick.bid]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

function cleanHttpsBase(value) {
  const raw = text(value).replace(/\/+$/, '');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('broker gateway URL must use clean https');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function defaultMt5PlanningMarketPrice(account, intent, env = {}, fetchFn = fetch) {
  const masterKey = text(env.TRADING_MASTER_KEY);
  const ciphertext = text(account?.credential_ciphertext ?? account?.credentialCiphertext);
  if (!masterKey || !ciphertext) throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 planning credentials unavailable');
  const credentials = await decryptConnectionCredentials('mt5_connector', ciphertext, masterKey);
  const baseUrl = cleanHttpsBase(credentials.gatewayUrl);
  const controlSecret = text(credentials.controlSecret);
  if (!controlSecret) throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 planning control credential unavailable');

  const rowId = text(account?.id);
  const identityResponse = await fetchFn(`${baseUrl}/v1/mt5-connections/${encodeURIComponent(rowId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
    signal: AbortSignal.timeout(5000),
  });
  const identity = await identityResponse.json().catch(() => ({}));
  if (!identityResponse.ok || identity?.online !== true || text(identity.accountRowId) !== rowId) {
    throw codedError('MT5_CONNECTOR_OFFLINE', 'MT5 connector is unavailable for broker-authoritative planning');
  }
  if (text(identity?.identity?.accountNumber) !== text(account?.account_id ?? account?.accountId)) {
    throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 broker account identity mismatch');
  }
  const expectedServer = text(account?.server_name ?? account?.serverName);
  if (expectedServer && text(identity?.identity?.serverName) !== expectedServer) {
    throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 broker server identity mismatch');
  }
  if (text(account?.environment).toLowerCase() === 'live' && identity?.identity?.isLive !== true) {
    throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 broker environment mismatch');
  }

  const persisted = accountSymbolCatalogFromProviderConfig(providerConfigOf(account));
  const liveCatalog = Array.isArray(identity?.identity?.symbols) && identity.identity.symbols.length
    ? identity.identity.symbols
    : persisted.catalog;
  const candidates = [canonicalSymbol(intent), text(intent?.symbol?.source)].filter(Boolean);
  let resolved = null;
  for (const candidate of [...new Set(candidates)]) {
    const result = resolveAccountSymbol(candidate, liveCatalog, persisted.aliases);
    if (result.ok) { resolved = result; break; }
  }
  if (!resolved) throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 planning symbol resolution failed');

  const contextResponse = await fetchFn(
    `${baseUrl}/v1/mt5-context/${encodeURIComponent(rowId)}?symbol=${encodeURIComponent(resolved.platformSymbol)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
      signal: AbortSignal.timeout(7000),
    },
  );
  const body = await contextResponse.json().catch(() => ({}));
  if (!contextResponse.ok || body?.ok !== true || text(body.accountRowId) !== rowId) {
    throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 broker market context unavailable');
  }
  const price = executionSidePrice(intent, body?.context?.tick || {});
  if (!(price > 0)) throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'MT5 broker tick unavailable');
  return price;
}

async function defaultCTraderPlanningMarketPrice(account, intent, env = {}) {
  const masterKey = text(env.TRADING_MASTER_KEY);
  const ciphertext = text(account?.credential_ciphertext ?? account?.credentialCiphertext);
  const accountId = Number(account?.account_id ?? account?.accountId);
  const environment = text(account?.environment).toLowerCase();
  if (!masterKey || !ciphertext || !Number.isInteger(accountId) || !['demo', 'live'].includes(environment)) {
    throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'cTrader planning credentials unavailable');
  }

  const credentials = await decryptConnectionCredentials('ctrader', ciphertext, masterKey);
  const session = new CTraderJsonSession({
    endpoint: ctraderEndpoint(environment, 'json'),
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });
  try {
    await session.open();
    await session.authenticateAccount(accountId, credentials.accessToken);
    const marketData = new CTraderMarketData({ session, accountId });
    const brokerAccount = await marketData.loadAccount();
    if (!brokerAccount?.canOpenTrades) throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'cTrader account cannot open trades');
    marketData.catalog = await marketData.loadCatalog();
    const persisted = accountSymbolCatalogFromProviderConfig(providerConfigOf(account));
    const candidates = [canonicalSymbol(intent), text(intent?.symbol?.source)].filter(Boolean);
    let resolved = null;
    for (const candidate of [...new Set(candidates)]) {
      const result = resolveAccountSymbol(candidate, marketData.catalog, persisted.aliases);
      if (result.ok) { resolved = result; break; }
    }
    if (!resolved || !Number.isInteger(Number(resolved.platformId))) {
      throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'cTrader planning symbol resolution failed');
    }
    const symbolId = Number(resolved.platformId);
    await marketData.subscribeQuotes([symbolId]);
    const spot = await session.waitForEvent(
      (message) => Number(message?.payloadType) === 2131 && Number(message?.payload?.symbolId) === symbolId,
      { timeoutMs: 5000 },
    );
    marketData.handleSpotEvent(spot);
    const price = marketData.marketPriceFor(resolved.platformSymbol, intent?.side);
    if (!(Number(price) > 0)) throw codedError('BROKER_MARKET_CONTEXT_UNAVAILABLE', 'cTrader broker tick unavailable');
    return Number(price);
  } finally {
    session.close?.();
  }
}

async function defaultBrokerPlanningMarketPrice(account, intent, env = {}) {
  if (isMt5ConnectorAccount(account)) return defaultMt5PlanningMarketPrice(account, intent, env);
  if (isCTraderOauthAccount(account)) return defaultCTraderPlanningMarketPrice(account, intent, env);
  return undefined;
}

async function defaultMt5BrokerSizing(account, intent, targetResolved, env = {}, fetchFn = fetch) {
  const masterKey = text(env.TRADING_MASTER_KEY);
  const ciphertext = text(account?.credential_ciphertext ?? account?.credentialCiphertext);
  const rowId = text(account?.id);
  const mode = text(account?.lot_sizing_type ?? account?.lotSizingType).toLowerCase();
  if (!masterKey || !ciphertext || !rowId || !['symbol_equivalent','balance_percent'].includes(mode)) {
    throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'MT5 broker sizing configuration invalid');
  }

  const config = lotSizingConfigOf(account);
  const maximumLots = Number(account?.lot_value ?? account?.lotValue);
  if (!(maximumLots > 0)) throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'MT5 lot preference is invalid');

  const credentials = await decryptConnectionCredentials('mt5_connector', ciphertext, masterKey);
  const baseUrl = cleanHttpsBase(credentials.gatewayUrl);
  const controlSecret = text(credentials.controlSecret);
  if (!controlSecret) throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'MT5 sizing control credential unavailable');

  const identityResponse = await fetchFn(`${baseUrl}/v1/mt5-connections/${encodeURIComponent(rowId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
    signal: AbortSignal.timeout(5000),
  });
  const identity = await identityResponse.json().catch(() => ({}));
  if (!identityResponse.ok || identity?.online !== true || text(identity.accountRowId) !== rowId) {
    throw codedError('MT5_CONNECTOR_OFFLINE', 'MT5 connector is unavailable for broker-aware sizing');
  }
  if (text(identity?.identity?.accountNumber) !== text(account?.account_id ?? account?.accountId)) {
    throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'MT5 broker account identity mismatch');
  }
  const expectedServer = text(account?.server_name ?? account?.serverName);
  if (expectedServer && text(identity?.identity?.serverName) !== expectedServer) {
    throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'MT5 broker server identity mismatch');
  }

  const liveCatalog = Array.isArray(identity?.identity?.symbols) ? identity.identity.symbols : [];
  const persisted = accountSymbolCatalogFromProviderConfig(providerConfigOf(account));
  const catalog = liveCatalog.length ? liveCatalog : persisted.catalog;

  const payload = {
    mode,
    targetSymbol: targetResolved.platformSymbol,
    maximumLots,
    side: String(intent?.side || '').toUpperCase(),
  };

  if (mode === 'symbol_equivalent') {
    const referenceSymbol = text(config.referenceSymbol);
    if (!referenceSymbol) throw codedError('REFERENCE_SYMBOL_REQUIRED', 'reference symbol is required for symbol-equivalent sizing');
    const referenceResolved = resolveAccountSymbol(referenceSymbol, catalog, persisted.aliases);
    if (!referenceResolved.ok) throw codedError('REFERENCE_SYMBOL_NOT_SUPPORTED', 'reference symbol is not supported by this MT5 account');
    payload.referenceSymbol = referenceResolved.platformSymbol;
  } else {
    const percent = Number(config.percent);
    if (!(percent > 0 && percent <= 100)) throw codedError('BALANCE_PERCENT_INVALID', 'balance percent must be between 0 and 100');
    payload.percent = percent;
  }

  const response = await fetchFn(`${baseUrl}/v1/mt5-broker-sizing/${encodeURIComponent(rowId)}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${controlSecret}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(7000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !(Number(body?.sizing?.lots) > 0)) {
    const reason = text(body?.reason) || 'MT5 broker sizing unavailable';
    throw codedError(reason, reason);
  }
  return body.sizing;
}

async function defaultCTraderBrokerSizing(account, intent, targetResolved, env = {}) {
  const masterKey = text(env.TRADING_MASTER_KEY);
  const ciphertext = text(account?.credential_ciphertext ?? account?.credentialCiphertext);
  const accountId = Number(account?.account_id ?? account?.accountId);
  const environment = text(account?.environment).toLowerCase();
  const mode = text(account?.lot_sizing_type ?? account?.lotSizingType).toLowerCase();
  const config = lotSizingConfigOf(account);
  const maximumLots = Number(account?.lot_value ?? account?.lotValue);

  if (!masterKey || !ciphertext || !Number.isInteger(accountId) || !['demo','live'].includes(environment)
      || !['symbol_equivalent','balance_percent'].includes(mode) || !(maximumLots > 0)) {
    throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'cTrader broker sizing configuration invalid');
  }

  const credentials = await decryptConnectionCredentials('ctrader', ciphertext, masterKey);
  const session = new CTraderJsonSession({
    endpoint: ctraderEndpoint(environment, 'json'),
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });

  try {
    await session.open();
    await session.authenticateAccount(accountId, credentials.accessToken);
    const marketData = new CTraderMarketData({ session, accountId });
    const brokerAccount = await marketData.loadAccount();
    if (!brokerAccount?.canOpenTrades) throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'cTrader account cannot open trades');
    marketData.catalog = await marketData.loadCatalog();
    const persisted = accountSymbolCatalogFromProviderConfig(providerConfigOf(account));

    const liveTarget = resolveAccountSymbol(targetResolved.platformSymbol, marketData.catalog, persisted.aliases);
    if (!liveTarget.ok || !Number.isInteger(Number(liveTarget.platformId))) {
      throw codedError('DESTINATION_SYMBOL_NOT_SUPPORTED', 'target symbol is not supported by this cTrader account');
    }

    if (mode === 'symbol_equivalent') {
      const referenceSymbol = text(config.referenceSymbol);
      if (!referenceSymbol) throw codedError('REFERENCE_SYMBOL_REQUIRED', 'reference symbol is required for symbol-equivalent sizing');
      const referenceResolved = resolveAccountSymbol(referenceSymbol, marketData.catalog, persisted.aliases);
      if (!referenceResolved.ok || !Number.isInteger(Number(referenceResolved.platformId))) {
        throw codedError('REFERENCE_SYMBOL_NOT_SUPPORTED', 'reference symbol is not supported by this cTrader account');
      }
      return buildSymbolEquivalentSizing({
        referenceLots: maximumLots,
        referenceInstrument: lotInstrumentFromResolved(referenceResolved, maximumLots),
        targetInstrument: lotInstrumentFromResolved(liveTarget, maximumLots),
        estimateReferenceMargin: (lots) => cTraderMarginForLots(marketData, referenceResolved, lots, intent?.side),
        estimateTargetMargin: (lots) => cTraderMarginForLots(marketData, liveTarget, lots, intent?.side),
      });
    }

    const percent = Number(config.percent);
    if (!(percent > 0 && percent <= 100)) throw codedError('BALANCE_PERCENT_INVALID', 'balance percent must be between 0 and 100');
    return buildBalancePercentSizing({
      maximumLots,
      percent,
      accountBalance: brokerAccount.balance,
      targetInstrument: lotInstrumentFromResolved(liveTarget, maximumLots),
      estimateTargetMargin: (lots) => cTraderMarginForLots(marketData, liveTarget, lots, intent?.side),
    });
  } finally {
    session.close?.();
  }
}

async function defaultBrokerSizing(account, intent, targetResolved, env = {}) {
  if (isMt5ConnectorAccount(account)) return defaultMt5BrokerSizing(account, intent, targetResolved, env);
  if (isCTraderOauthAccount(account)) return defaultCTraderBrokerSizing(account, intent, targetResolved, env);
  throw codedError('BROKER_SIZING_CONTEXT_UNAVAILABLE', 'broker-aware sizing is not supported by this broker connection mode');
}

function hasAuthoritativeCatalog(account = {}) {
  return accountSymbolCatalogFromProviderConfig(providerConfigOf(account)).catalog.length > 0;
}

async function defaultMt5AccountCatalogLoader(account, env = {}, fetchFn = fetch) {
  if (!isMt5ConnectorAccount(account)) return null;
  const masterKey = text(env?.TRADING_MASTER_KEY);
  const ciphertext = text(account?.credential_ciphertext ?? account?.credentialCiphertext);
  const rowId = text(account?.id);
  if (!masterKey || !ciphertext || !rowId) return null;

  const credentials = await decryptConnectionCredentials('mt5_connector', ciphertext, masterKey);
  const baseUrl = cleanHttpsBase(credentials.gatewayUrl);
  const controlSecret = text(credentials.controlSecret);
  if (!controlSecret) return null;

  const response = await fetchFn(`${baseUrl}/v1/mt5-connections/${encodeURIComponent(rowId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.online !== true || text(body.accountRowId) !== rowId) return null;

  const identity = body?.identity || {};
  if (text(identity.accountNumber) !== text(account?.account_id ?? account?.accountId)) return null;
  const expectedServer = text(account?.server_name ?? account?.serverName);
  if (expectedServer && text(identity.serverName) !== expectedServer) return null;
  const expectedEnvironment = text(account?.environment).toLowerCase();
  if (expectedEnvironment === 'live' && identity.isLive !== true) return null;
  if (expectedEnvironment === 'demo' && identity.isLive !== false) return null;

  const catalog = Array.isArray(identity.symbols) ? identity.symbols : [];
  if (!catalog.length) return null;
  return { catalog, aliases: providerConfigOf(account).symbolAliases || {} };
}

async function defaultCTraderAccountCatalogLoader(account, env = {}) {
  if (!isCTraderOauthAccount(account)) return null;
  const masterKey = text(env?.TRADING_MASTER_KEY);
  const ciphertext = text(account?.credential_ciphertext ?? account?.credentialCiphertext);
  const accountId = Number(account?.account_id ?? account?.brokerAccountId);
  const environment = text(account?.environment ?? account?.server_name ?? account?.serverName).toLowerCase();
  if (!masterKey || !ciphertext || !Number.isInteger(accountId) || !['demo', 'live'].includes(environment)) return null;

  const credentials = await decryptConnectionCredentials('ctrader', ciphertext, masterKey);
  const session = new CTraderJsonSession({
    endpoint: ctraderEndpoint(environment, 'json'),
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
  });

  try {
    await session.open();
    await session.authenticateAccount(accountId, credentials.accessToken);
    const marketData = new CTraderMarketData({ session, accountId });
    const brokerAccount = await marketData.loadAccount();
    if (!brokerAccount?.canOpenTrades) return null;
    const catalog = await marketData.loadCatalog();
    if (!Array.isArray(catalog) || catalog.length === 0) return null;
    return { catalog, aliases: providerConfigOf(account).symbolAliases || {} };
  } finally {
    session.close?.();
  }
}

async function persistAccountCatalog(supabase, account, hydrated = {}) {
  const catalog = Array.isArray(hydrated?.catalog) ? hydrated.catalog : [];
  if (!catalog.length) return account;
  const currentConfig = providerConfigOf(account);
  const aliases = hydrated?.aliases && typeof hydrated.aliases === 'object' && !Array.isArray(hydrated.aliases)
    ? hydrated.aliases
    : (currentConfig.symbolAliases || {});
  const providerConfig = {
    ...currentConfig,
    symbolCatalog: catalog,
    symbolAliases: aliases,
    symbolCatalogUpdatedAt: new Date().toISOString(),
  };

  const query = supabase
    .from('trade_accounts')
    .update({ provider_config: providerConfig })
    .eq('workspace_id', text(account?.workspace_id ?? account?.workspaceId))
    .eq('id', text(account?.id));
  if (query?.select) {
    const result = await query.select('id');
    if (result?.error) throw new Error('failed to persist hydrated broker symbol catalog');
  } else {
    const result = await query;
    if (result?.error) throw new Error('failed to persist hydrated broker symbol catalog');
  }
  return { ...account, provider_config: providerConfig };
}

async function hydrateMissingAccountCatalogs(accounts, { supabase, env, accountCatalogLoader } = {}) {
  const loader = typeof accountCatalogLoader === 'function'
    ? accountCatalogLoader
    : (account) => {
      if (isCTraderOauthAccount(account)) return defaultCTraderAccountCatalogLoader(account, env);
      if (isMt5ConnectorAccount(account)) return defaultMt5AccountCatalogLoader(account, env);
      return null;
    };

  return Promise.all((accounts || []).map(async (account) => {
    const supportsHydration = isCTraderOauthAccount(account) || isMt5ConnectorAccount(account);
    if (!supportsHydration || hasAuthoritativeCatalog(account)) return account;

    let hydrated;
    try {
      hydrated = await loader(account);
    } catch {
      return account;
    }
    if (!Array.isArray(hydrated?.catalog) || hydrated.catalog.length === 0) return account;

    const currentConfig = providerConfigOf(account);
    const aliases = hydrated?.aliases && typeof hydrated.aliases === 'object' && !Array.isArray(hydrated.aliases)
      ? hydrated.aliases
      : (currentConfig.symbolAliases || {});
    const inMemoryAccount = {
      ...account,
      provider_config: {
        ...currentConfig,
        symbolCatalog: hydrated.catalog,
        symbolAliases: aliases,
        symbolCatalogUpdatedAt: new Date().toISOString(),
      },
    };

    // Persistence is only a cache optimization. A successful broker catalog
    // load is authoritative for this execution and must not be discarded just
    // because the cache write is temporarily unavailable.
    try {
      return await persistAccountCatalog(supabase, account, hydrated);
    } catch {
      return inMemoryAccount;
    }
  }));
}

function resolveDestinationSymbol(account, symbol, sourceSymbol = null) {
  const { catalog, aliases } = accountSymbolCatalogFromProviderConfig(account?.provider_config ?? {});
  if (!catalog.length) {
    throw codedError(
      'DESTINATION_SYMBOL_CATALOG_UNAVAILABLE',
      `destination symbol catalog is unavailable for ${symbol || 'UNKNOWN'}`,
    );
  }

  const candidates = [...new Set([symbol, sourceSymbol].map(text).filter(Boolean))];
  let last = { ok: false, reason: 'SYMBOL_NOT_FOUND' };
  for (const candidate of candidates) {
    const resolved = resolveAccountSymbol(candidate, catalog, aliases);
    if (resolved.ok) return resolved;
    if (resolved.reason === 'AMBIGUOUS_SYMBOL') {
      throw codedError(
        'DESTINATION_SYMBOL_AMBIGUOUS',
        `destination symbol resolution failed for ${candidate}: AMBIGUOUS_SYMBOL`,
      );
    }
    last = resolved;
  }

  throw codedError(
    'DESTINATION_SYMBOL_NOT_SUPPORTED',
    `destination symbol resolution failed for ${candidates.join(' / ') || 'UNKNOWN'}: ${last.reason || 'SYMBOL_NOT_FOUND'}`,
  );
}

async function routedBrokerAccountIds(supabase, workspaceId, sourceId, { event = {}, interpretation = {} } = {}) {
  const trustedSourceId = text(sourceId);
  if (!trustedSourceId) return [];

  const { data: routesData, error: routeError } = await supabase
    .from('source_destination_routes')
    .select('destination_id,priority,source_feed_id,filters')
    .eq('workspace_id', workspaceId)
    .eq('source_connection_id', trustedSourceId)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (routeError) throw new Error('failed to load source broker routes');

  const routes = Array.isArray(routesData) ? routesData : [];
  let feedId = null;
  const providerFeedId = providerFeedIdFromEvent(event);
  if (providerFeedId) {
    const { data: feed, error: feedError } = await supabase
      .from('source_feeds')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('source_connection_id', trustedSourceId)
      .eq('provider_feed_id', providerFeedId)
      .eq('is_active', true)
      .maybeSingle();
    if (feedError) throw new Error('failed to resolve source feed for broker routes');
    feedId = text(feed?.id) || null;
  }

  const selectedRoutes = selectAuthorizedRoutesForFeed(routes, feedId);
  if (!selectedRoutes.length) return [];

  const destinationIds = selectedRoutes.map((row) => text(row.destination_id)).filter(Boolean);
  if (!destinationIds.length) return [];

  const { data: destinations, error: destinationError } = await supabase
    .from('trading_destinations')
    .select('id,destination_ref,destination_type,is_active')
    .eq('workspace_id', workspaceId)
    .eq('destination_type', 'broker_account')
    .eq('is_active', true)
    .in('id', destinationIds);
  if (destinationError) throw new Error('failed to load broker destinations');

  const byDestination = new Map((destinations || []).map((row) => [text(row.id), row]));
  return selectedRoutes
    .map((route) => ({ route, destination: byDestination.get(text(route.destination_id)) }))
    .filter(({ destination }) => Boolean(destination))
    .filter(({ route, destination }) => evaluateRouteFilters(route.filters, interpretation, destination).allowed)
    .map(({ destination }) => text(destination.destination_ref))
    .filter(Boolean);
}

export async function createV1SimulationDependencies({ env = {}, supabase, event = {}, interpretation = {}, sourceId, accountCatalogLoader, brokerMarketPriceLoader, brokerSizingLoader } = {}) {
  if (!supabase?.from) throw new Error('Supabase client is required for simulation');
  const workspaceId = String(event?.workspace_hint || '');
  if (!workspaceId) throw new Error('authenticated workspace is required for simulation');

  const state = createTradeStateClient(env, workspaceId);
  const instruments = parseJsonConfig(env.TRADING_V1_SIMULATION_INSTRUMENTS, 'TRADING_V1_SIMULATION_INSTRUMENTS');
  const prices = parseJsonConfig(env.TRADING_V1_SIMULATION_PRICES, 'TRADING_V1_SIMULATION_PRICES');
  const exposures = parseJsonConfig(env.TRADING_V1_SIMULATION_EXPOSURES, 'TRADING_V1_SIMULATION_EXPOSURES');

  return {
    ...state,
    async accountProvider() {
      const accountIds = await routedBrokerAccountIds(supabase, workspaceId, sourceId, { event, interpretation });
      if (!accountIds.length) return [];
      const { data, error } = await supabase
        .from('trade_accounts')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .in('id', accountIds);
      if (error) throw new Error(`failed to load routed execution accounts: ${error.message || 'database error'}`);
      const accountMap = new Map((data || []).map((row) => [String(row.id), row]));
      const orderedAccounts = accountIds.map((id) => accountMap.get(id)).filter(Boolean);
      return hydrateMissingAccountCatalogs(orderedAccounts, { supabase, env, accountCatalogLoader });
    },
    async instrumentProvider(account, intent) {
      const symbol = canonicalSymbol(intent);
      const sourceSymbol = text(intent?.symbol?.source);
      const resolvedSymbol = resolveDestinationSymbol(account, symbol, sourceSymbol);
      const instrument = instruments[symbol];
      if (instrument && typeof instrument === 'object') {
        return {
          canonical: symbol,
          ...instrument,
          platformSymbol: resolvedSymbol.platformSymbol,
        };
      }

      const lotSizingType = String(account?.lot_sizing_type || '').trim().toLowerCase();
      const lotValue = Number(account?.lot_value);
      if (['fixed', 'adaptive_percent', 'symbol_equivalent', 'balance_percent'].includes(lotSizingType) && Number.isFinite(lotValue) && lotValue > 0) {
        const brokerMinLots = Number(resolvedSymbol.minLots ?? resolvedSymbol.minVolume);
        const brokerMaxLots = Number(resolvedSymbol.maxLots ?? resolvedSymbol.maxVolume);
        const brokerStepLots = Number(resolvedSymbol.stepLots ?? resolvedSymbol.stepVolume);
        const result = {
          canonical: symbol,
          platformSymbol: resolvedSymbol.platformSymbol,
          minLots: Number.isFinite(brokerMinLots) && brokerMinLots > 0 ? brokerMinLots : lotValue,
          maxLots: Number.isFinite(brokerMaxLots) && brokerMaxLots > 0 ? brokerMaxLots : lotValue,
          stepLots: Number.isFinite(brokerStepLots) && brokerStepLots > 0 ? brokerStepLots : lotValue,
          ...(Number.isFinite(Number(resolvedSymbol.tickSize)) ? { tickSize: Number(resolvedSymbol.tickSize) } : {}),
          ...(Number.isFinite(Number(resolvedSymbol.tickValue)) ? { tickValue: Number(resolvedSymbol.tickValue) } : {}),
          ...(Number.isFinite(Number(resolvedSymbol.tickValueLoss)) ? { tickValueLoss: Number(resolvedSymbol.tickValueLoss) } : {}),
          ...(Number.isFinite(Number(resolvedSymbol.tickValueProfit)) ? { tickValueProfit: Number(resolvedSymbol.tickValueProfit) } : {}),
          ...(Number.isFinite(Number(resolvedSymbol.contractSize)) ? { contractSize: Number(resolvedSymbol.contractSize) } : {}),
          ...(Number.isFinite(Number(resolvedSymbol.digits)) ? { digits: Number(resolvedSymbol.digits) } : {}),
        };
        if (['symbol_equivalent', 'balance_percent'].includes(lotSizingType)) {
          const loader = typeof brokerSizingLoader === 'function'
            ? brokerSizingLoader
            : (candidateAccount, candidateIntent, candidateResolved) => defaultBrokerSizing(candidateAccount, candidateIntent, candidateResolved, env);
          const sizing = await loader(account, intent, resolvedSymbol);
          if (!(Number(sizing?.lots) > 0)) throw new Error('broker-aware sizing unavailable');
          if (lotSizingType === 'symbol_equivalent') result.symbolEquivalentLots = Number(sizing.lots);
          else result.balancePercentLots = Number(sizing.lots);
          result.brokerSizing = sizing;
        }
        return result;
      }

      throw new Error(`simulation instrument metadata is not configured for ${symbol || 'UNKNOWN'}`);
    },
    async marketPriceProvider(account, intent) {
      // Static prices belong only to explicit simulation transport. Real
      // planning asks the broker path for a current quote so fast-completion
      // target validity cannot be decided by stale fixtures.
      const transportMode = String(env.TRADING_EXECUTION_TRANSPORT_MODE ?? 'real').trim().toLowerCase();
      if (transportMode === 'simulation') {
        const symbol = canonicalSymbol(intent);
        const price = Number(prices[symbol]);
        return Number.isFinite(price) ? price : undefined;
      }
      const loader = typeof brokerMarketPriceLoader === 'function'
        ? brokerMarketPriceLoader
        : (candidateAccount, candidateIntent) => defaultBrokerPlanningMarketPrice(candidateAccount, candidateIntent, env);
      return loader(account, intent);
    },
    async exposureProvider(account) {
      const configured = exposures[String(account?.id || '')];
      return configured && typeof configured === 'object' ? configured : {};
    },
  };
}