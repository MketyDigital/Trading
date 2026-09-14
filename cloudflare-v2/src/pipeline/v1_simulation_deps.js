import { accountSymbolCatalogFromProviderConfig, resolveAccountSymbol } from '../execution/account_symbol_catalog.js';
import { decryptConnectionCredentials } from '../security/connection_credentials.js';
import { CTraderJsonSession } from '../adapters/ctrader_session.js';
import { CTraderMarketData } from '../adapters/ctrader_market_data.js';
import { ctraderEndpoint } from '../adapters/ctrader_protocol.js';

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
  const headers = internalHeaders(env);

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
      // Keep the account in the routing set. The existing destination-symbol gate
      // will fail this destination closed without preventing other routed brokers
      // from being evaluated.
      return account;
    }
  }));
}

function resolveDestinationSymbol(account, symbol) {
  const { catalog, aliases } = accountSymbolCatalogFromProviderConfig(account?.provider_config ?? {});
  if (!catalog.length) {
    throw codedError(
      'DESTINATION_SYMBOL_CATALOG_UNAVAILABLE',
      `destination symbol catalog is unavailable for ${symbol || 'UNKNOWN'}`,
    );
  }

  const resolved = resolveAccountSymbol(symbol, catalog, aliases);
  if (!resolved.ok) {
    const code = resolved.reason === 'AMBIGUOUS_SYMBOL'
      ? 'DESTINATION_SYMBOL_AMBIGUOUS'
      : 'DESTINATION_SYMBOL_NOT_SUPPORTED';
    throw codedError(
      code,
      `destination symbol resolution failed for ${symbol || 'UNKNOWN'}: ${resolved.reason || 'SYMBOL_NOT_FOUND'}`,
    );
  }
  return resolved;
}

async function routedBrokerAccountIds(supabase, workspaceId, sourceId) {
  const trustedSourceId = String(sourceId || '').trim();
  if (!trustedSourceId) return [];

  const { data: routes, error: routeError } = await supabase
    .from('source_destination_routes')
    .select('destination_id,priority')
    .eq('workspace_id', workspaceId)
    .eq('source_connection_id', trustedSourceId)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (routeError) throw new Error('failed to load source broker routes');

  const destinationIds = (routes || []).map((row) => String(row.destination_id || '').trim()).filter(Boolean);
  if (!destinationIds.length) return [];

  const { data: destinations, error: destinationError } = await supabase
    .from('trading_destinations')
    .select('id,destination_ref,destination_type,is_active')
    .eq('workspace_id', workspaceId)
    .eq('destination_type', 'broker_account')
    .eq('is_active', true)
    .in('id', destinationIds);
  if (destinationError) throw new Error('failed to load broker destinations');

  const byDestination = new Map((destinations || []).map((row) => [String(row.id), row]));
  return destinationIds
    .map((id) => byDestination.get(id))
    .filter(Boolean)
    .map((row) => String(row.destination_ref || '').trim())
    .filter(Boolean);
}

export async function createV1SimulationDependencies({ env = {}, supabase, event = {}, sourceId, accountCatalogLoader } = {}) {
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
      const accountIds = await routedBrokerAccountIds(supabase, workspaceId, sourceId);
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
      const resolvedSymbol = resolveDestinationSymbol(account, symbol);
      const instrument = instruments[symbol];
      if (instrument && typeof instrument === 'object') {
        return {
          canonical: symbol,
          ...instrument,
          platformSymbol: resolvedSymbol.platformSymbol,
        };
      }

      const environment = String(account?.environment || '').trim().toLowerCase();
      const lotSizingType = String(account?.lot_sizing_type || '').trim().toLowerCase();
      const lotValue = Number(account?.lot_value);
      if (environment === 'demo' && lotSizingType === 'fixed' && Number.isFinite(lotValue) && lotValue > 0) {
        return {
          canonical: symbol,
          platformSymbol: resolvedSymbol.platformSymbol,
          minLots: lotValue,
          maxLots: lotValue,
          stepLots: lotValue,
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