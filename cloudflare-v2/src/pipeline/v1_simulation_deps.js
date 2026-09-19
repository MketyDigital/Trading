import { accountSymbolCatalogFromProviderConfig, resolveAccountSymbol } from '../execution/account_symbol_catalog.js';
import { decryptConnectionCredentials } from '../security/connection_credentials.js';
import { CTraderJsonSession } from '../adapters/ctrader_session.js';
import { CTraderMarketData } from '../adapters/ctrader_market_data.js';
import { ctraderEndpoint } from '../adapters/ctrader_protocol.js';
import { providerFeedIdFromEvent } from '../sources/source_feed_store.js';
import { evaluateRouteFilters } from '../destinations/route_filters.js';
import { selectAuthorizedRoutesForFeed } from '../routes/logical_route_scope.js';

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

function isCTraderOauthAccount(account = {}) {
  return text(account?.platform).toLowerCase() === 'ctrader'
    && text(account?.provider_mode ?? account?.providerMode).toLowerCase() === 'ctrader_oauth';
}

function hasAuthoritativeCatalog(account = {}) {
  return accountSymbolCatalogFromProviderConfig(providerConfigOf(account)).catalog.length > 0;
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
    : (account) => defaultCTraderAccountCatalogLoader(account, env);

  return Promise.all((accounts || []).map(async (account) => {
    if (!isCTraderOauthAccount(account) || hasAuthoritativeCatalog(account)) return account;
    try {
      const hydrated = await loader(account);
      if (!Array.isArray(hydrated?.catalog) || hydrated.catalog.length === 0) return account;
      return await persistAccountCatalog(supabase, account, hydrated);
    } catch {
      return account;
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
        `destination symbol resolution is ambiguous for ${candidate}`,
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

export async function createV1SimulationDependencies({ env = {}, supabase, event = {}, interpretation = {}, sourceId, accountCatalogLoader } = {}) {
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
      if (lotSizingType === 'fixed' && Number.isFinite(lotValue) && lotValue > 0) {
        const brokerMinLots = Number(resolvedSymbol.minLots ?? resolvedSymbol.minVolume);
        const brokerMaxLots = Number(resolvedSymbol.maxLots ?? resolvedSymbol.maxVolume);
        const brokerStepLots = Number(resolvedSymbol.stepLots ?? resolvedSymbol.stepVolume);
        return {
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
      }

      throw new Error(`simulation instrument metadata is not configured for ${symbol || 'UNKNOWN'}`);
    },
    async marketPriceProvider(_account, intent) {
      const symbol = canonicalSymbol(intent);
      const price = Number(prices[symbol]);
      return Number.isFinite(price) ? price : undefined;
    },
    async exposureProvider(account) {
      const configured = exposures[String(account?.id || '')];
      return configured && typeof configured === 'object' ? configured : {};
    },
  };
}