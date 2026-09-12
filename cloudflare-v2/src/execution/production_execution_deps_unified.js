import { createProductionExecutionDependencies as createLegacyProductionExecutionDependencies } from './production_execution_deps.js';
import { decryptConnectionCredentials } from '../security/connection_credentials.js';
import { createSupabaseDeliveryStore } from '../persistence/supabase_delivery_store.js';
import { createContextualDeliveryStore } from './destination_retry_composition.js';
import { executeMt5ConnectorAction } from '../adapters/mt5_connector_executor_v2.js';
import { accountSymbolCatalogFromProviderConfig, resolveAccountSymbol } from './account_symbol_catalog.js';
import { validateProductionRiskAction } from './production_risk_authority.js';

function text(value) { return String(value ?? '').trim(); }
function workspaceOf(account = {}) { return text(account.workspace_id ?? account.workspaceId); }
function accountRef(account = {}) { return text(account.id ?? account.accountId ?? account.account_id); }
function brokerAccountIdOf(account = {}) { return text(account.account_id ?? account.brokerAccountId); }
function providerModeOf(account = {}) { return text(account.provider_mode ?? account.providerMode).toLowerCase(); }
function platformOf(account = {}) { return text(account.platform).toLowerCase(); }
function providerConfigOf(account = {}) {
  const config = account.provider_config ?? account.providerConfig;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}
function sizingModeOf(account = {}) { return text(account.sizingMode ?? account.sizing_mode).toUpperCase(); }
function safetyPolicyOf(account = {}) {
  const policy = account.safety_policy ?? account.safetyPolicy;
  return policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {};
}
function configuredPositive(policy, key) {
  const value = Number(policy?.[key]);
  return Number.isFinite(value) && value > 0;
}
function requiresDynamicExposure(account = {}) {
  const policy = safetyPolicyOf(account);
  return configuredPositive(policy, 'maxDailyLossPercent') || configuredPositive(policy, 'maxOpenRiskPercent');
}
function isMt5Connector(account = {}) {
  return platformOf(account) === 'mt5' && providerModeOf(account) === 'mt5_connector';
}
function assertBoundConnectorAccount(account, workspaceId) {
  if (!account || typeof account !== 'object') throw new Error('production trade account is required');
  if (workspaceOf(account) !== workspaceId) throw new Error('production execution workspace mismatch');
  const brokerAccountId = brokerAccountIdOf(account);
  const status = text(providerConfigOf(account).status).toLowerCase();
  if (!accountRef(account) || !brokerAccountId || brokerAccountId.toLowerCase().startsWith('pending:') || status !== 'connected') {
    const error = new Error('MT5 connector trade account is not synchronized and connected');
    error.code = 'MT5_CONNECTOR_NOT_CONNECTED';
    throw error;
  }
}

async function loadConnectorCredentials(account, env, decryptCredentialsFn) {
  const masterKey = text(env.TRADING_MASTER_KEY);
  const ciphertext = text(account.credential_ciphertext ?? account.credentialCiphertext);
  if (!masterKey || !ciphertext) throw new Error('production broker credentials are unavailable');
  try {
    return await decryptCredentialsFn('mt5_connector', ciphertext, masterKey);
  } catch {
    throw new Error('production broker credentials are unavailable');
  }
}

function normalizeGatewayUrl(value) {
  const raw = text(value).replace(/\/+$/, '');
  if (!raw) throw new Error('MT5 connector gateway URL is not configured');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('MT5 connector gateway URL is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('MT5 connector gateway URL must use clean https');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function readJson(response, label) {
  let body;
  try { body = await response.json(); }
  catch { throw new Error(`${label} returned invalid JSON`); }
  if (!response.ok || body?.ok === false) throw new Error(`${label} request failed: ${body?.reason || response.status}`);
  return body;
}

async function loadConnectorIdentity({ account, credentials, fetchFn }) {
  const baseUrl = normalizeGatewayUrl(credentials.gatewayUrl);
  const controlSecret = text(credentials.controlSecret);
  if (!controlSecret) throw new Error('MT5 connector control credential is unavailable');
  const rowId = accountRef(account);
  let response;
  try {
    response = await fetchFn(`${baseUrl}/v1/mt5-connections/${encodeURIComponent(rowId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    const error = new Error('MT5 connector identity is unavailable');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  const body = await readJson(response, 'MT5 connector identity');
  if (String(body.accountRowId ?? '') !== rowId || body.online !== true) {
    const error = new Error('MT5 connector identity mismatch or offline');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  const identity = body.identity && typeof body.identity === 'object' ? body.identity : {};
  if (text(identity.accountNumber) !== brokerAccountIdOf(account)) {
    const error = new Error('MT5 connector broker account identity mismatch');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  const expectedServer = text(account.server_name ?? account.serverName);
  if (expectedServer && text(identity.serverName) !== expectedServer) {
    const error = new Error('MT5 connector broker server identity mismatch');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  return { baseUrl, controlSecret, identity };
}

function currentMarketPrice(action, tick = {}) {
  const side = text(action?.side).toUpperCase();
  const preferred = side === 'BUY' ? tick.ask : side === 'SELL' ? tick.bid : null;
  for (const value of [preferred, tick.last, tick.ask, tick.bid]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

function instrumentForRisk(resolved, contextSymbol = {}) {
  const symbol = { ...resolved, ...contextSymbol };
  return {
    ...symbol,
    platformSymbol: text(symbol.platformSymbol),
    tickSize: Number(symbol.tickSize),
    tickValuePerLot: Number(symbol.tickValueLoss ?? symbol.tickValueLossPerLot ?? symbol.tickValue ?? symbol.tickValuePerLot),
    tickValueLossPerLot: Number(symbol.tickValueLoss ?? symbol.tickValueLossPerLot ?? symbol.tickValue ?? symbol.tickValuePerLot),
    tickValueProfitPerLot: Number(symbol.tickValueProfit ?? symbol.tickValueProfitPerLot ?? symbol.tickValue ?? symbol.tickValuePerLot),
    minLots: Number(symbol.minLots ?? symbol.minVolume),
    maxLots: Number(symbol.maxLots ?? symbol.maxVolume),
    stepLots: Number(symbol.stepLots ?? symbol.stepVolume),
    contractSize: Number(symbol.contractSize),
  };
}

async function loadMt5ConnectorRiskContext({ account, action, credentials, fetchFn }) {
  const connection = await loadConnectorIdentity({ account, credentials, fetchFn });
  const persisted = accountSymbolCatalogFromProviderConfig(providerConfigOf(account));
  const liveCatalog = Array.isArray(connection.identity.symbols) && connection.identity.symbols.length
    ? connection.identity.symbols
    : persisted.catalog;
  const resolved = resolveAccountSymbol(action.symbol, liveCatalog, persisted.aliases);
  if (!resolved.ok) {
    const error = new Error(`broker risk context unavailable: ${resolved.reason || 'symbol resolution failed'}`);
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  let response;
  try {
    response = await fetchFn(`${connection.baseUrl}/v1/mt5-context/${encodeURIComponent(accountRef(account))}?symbol=${encodeURIComponent(resolved.platformSymbol)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${connection.controlSecret}` },
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    const error = new Error('broker risk context unavailable: MT5 connector context request failed');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  const body = await readJson(response, 'MT5 connector context');
  if (String(body.accountRowId ?? '') !== accountRef(account)) {
    const error = new Error('broker risk context unavailable: MT5 connector context account mismatch');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  if (text(context?.account?.accountNumber) !== brokerAccountIdOf(account)) {
    const error = new Error('broker risk context unavailable: MT5 broker account mismatch');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  return {
    brokerAccount: context.account || {},
    instrument: instrumentForRisk(resolved, context.symbol || {}),
    currentMarketPrice: currentMarketPrice(action, context.tick || {}),
  };
}

function deliveryStoreFor({ factory, supabase, workspaceId, account, tradingEventId, groupId }) {
  const id = accountRef(account);
  const baseStore = factory(supabase, {
    workspaceId,
    destinationType: 'mt5',
    destinationRef: `trade-account:${id}`,
    tradingEventId: tradingEventId || null,
  });
  return createContextualDeliveryStore(baseStore, {
    accountId: id,
    groupId: text(groupId) || null,
    destinationType: 'mt5',
  });
}

export function createProductionExecutionDependencies(config = {}, overrides = {}) {
  const {
    decryptCredentialsFn = decryptConnectionCredentials,
    deliveryStoreFactory = createSupabaseDeliveryStore,
    mt5ConnectorExecutor = executeMt5ConnectorAction,
    exposureLoader = null,
    fetchFn = fetch,
  } = overrides;
  const base = createLegacyProductionExecutionDependencies(config, {
    ...overrides,
    decryptCredentialsFn,
    deliveryStoreFactory,
    exposureLoader,
    fetchFn,
  });
  const env = config.env || {};
  const supabase = config.supabase;
  const workspaceId = text(config.workspaceId);
  const tradingEventId = text(config.tradingEventId);

  async function loadExposure(account, action) {
    if (typeof exposureLoader === 'function') {
      const exposure = await exposureLoader({ workspaceId, tradingEventId: tradingEventId || null, account, action });
      const daily = Number(exposure?.currentDailyPnlPercent);
      const open = Number(exposure?.currentOpenRiskPercent);
      if (!Number.isFinite(daily) || !Number.isFinite(open)) {
        const error = new Error('authoritative production exposure context is incomplete');
        error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
        throw error;
      }
      return { currentDailyPnlPercent: daily, currentOpenRiskPercent: open };
    }
    if (requiresDynamicExposure(account)) {
      const error = new Error('authoritative production exposure context is required by account policy');
      error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
      throw error;
    }
    return { currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 };
  }

  async function riskMaterializer(input = {}) {
    const account = input.account;
    if (!isMt5Connector(account)) return base.riskMaterializer(input);
    if (text(input.workspaceId) !== workspaceId) throw new Error('production execution workspace mismatch');
    assertBoundConnectorAccount(account, workspaceId);
    const action = input.action;
    if (!action || typeof action !== 'object') throw new TypeError('canonical action is required');
    const exposure = await loadExposure(account, action);
    const riskSized = ['RISK_PERCENT', 'FIXED_RISK'].includes(sizingModeOf(account));
    if (!riskSized || text(action.type).toUpperCase() !== 'OPEN_POSITION') {
      const result = validateProductionRiskAction({ account, action, brokerAccount: {}, instrument: {}, exposure });
      return { ...result, policyRequest: result.policyContext };
    }
    const credentials = await loadConnectorCredentials(account, env, decryptCredentialsFn);
    const context = await loadMt5ConnectorRiskContext({ account, action, credentials, fetchFn });
    const result = validateProductionRiskAction({ account, action, ...context, exposure });
    return { ...result, policyRequest: result.policyContext };
  }

  async function dispatchAction(input = {}) {
    const account = input.account;
    if (!isMt5Connector(account)) return base.dispatchAction(input);
    if (text(input.workspaceId) !== workspaceId) throw new Error('production execution workspace mismatch');
    assertBoundConnectorAccount(account, workspaceId);
    const action = input.action;
    if (!action || typeof action !== 'object') throw new TypeError('canonical action is required');
    const credentials = await loadConnectorCredentials(account, env, decryptCredentialsFn);
    const gatewayUrl = normalizeGatewayUrl(credentials.gatewayUrl);
    const controlSecret = text(credentials.controlSecret);
    if (!controlSecret) throw new Error('MT5 connector control credential is unavailable');
    const symbols = accountSymbolCatalogFromProviderConfig(providerConfigOf(account));
    const deliveryStore = deliveryStoreFor({
      factory: deliveryStoreFactory,
      supabase,
      workspaceId,
      account,
      tradingEventId,
      groupId: input.groupId,
    });
    return mt5ConnectorExecutor(action, {
      workspaceId,
      accountRowId: accountRef(account),
      gatewayUrl,
      controlSecret,
      symbolCatalog: symbols.catalog,
      symbolAliases: symbols.aliases,
      // Compatibility aliases keep injected tests/adapters simple while the executor uses explicit names above.
      catalog: symbols.catalog,
      aliases: symbols.aliases,
      deliveryStore,
      fetchFn,
    });
  }

  return { ...base, riskMaterializer, dispatchAction };
}
