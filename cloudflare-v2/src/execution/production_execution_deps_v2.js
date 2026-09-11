import { createProductionExecutionDependencies as createLegacyProductionExecutionDependencies } from './production_execution_deps.js';
import { decryptConnectionCredentials } from '../security/connection_credentials.js';
import { createSupabaseDeliveryStore } from '../persistence/supabase_delivery_store.js';
import { createContextualDeliveryStore } from './destination_retry_composition.js';
import { validateProductionRiskAction } from './production_risk_authority.js';
import { executeMt5ConnectorAction } from '../adapters/mt5_connector_executor_v2.js';
import { accountSymbolCatalogFromProviderConfig, resolveAccountSymbol } from './account_symbol_catalog.js';

function text(value) { return String(value ?? '').trim(); }
function providerModeOf(account = {}) { return text(account.provider_mode ?? account.providerMode).toLowerCase(); }
function workspaceOf(account = {}) { return text(account.workspace_id ?? account.workspaceId); }
function accountRef(account = {}) { return text(account.id ?? account.accountId ?? account.account_id); }
function brokerAccountIdOf(account = {}) { return text(account.account_id ?? account.brokerAccountId); }
function providerConfigOf(account = {}) {
  const value = account.provider_config ?? account.providerConfig;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function sizingModeOf(account = {}) { return text(account.sizingMode ?? account.sizing_mode).toUpperCase(); }
function safetyPolicyOf(account = {}) {
  const value = account.safety_policy ?? account.safetyPolicy;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function configuredPositive(policy = {}, key) {
  const value = Number(policy?.[key]);
  return Number.isFinite(value) && value > 0;
}
function requiresDynamicExposure(account = {}) {
  const policy = safetyPolicyOf(account);
  return configuredPositive(policy, 'maxDailyLossPercent') || configuredPositive(policy, 'maxOpenRiskPercent');
}
function isRiskSizedOpen(account = {}, action = {}) {
  return ['RISK_PERCENT', 'FIXED_RISK'].includes(sizingModeOf(account)) && text(action.type).toUpperCase() === 'OPEN_POSITION';
}
function currentEntryPrice(action = {}, tick = {}) {
  if (action?.entry?.kind === 'PRICE') {
    const value = Number(action.entry.value);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const explicit = Number(action.entryPrice);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const side = text(action.side).toUpperCase();
  const preferred = Number(side === 'SELL' ? tick.bid : tick.ask);
  if (Number.isFinite(preferred) && preferred > 0) return preferred;
  for (const value of [tick.last, tick.ask, tick.bid]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}
function instrumentForRisk(symbol = {}) {
  return {
    platformSymbol: symbol.platformSymbol,
    minLots: Number(symbol.minLots ?? symbol.minVolume),
    maxLots: Number(symbol.maxLots ?? symbol.maxVolume),
    stepLots: Number(symbol.stepLots ?? symbol.stepVolume),
    tickSize: Number(symbol.tickSize),
    tickValuePerLot: Number(symbol.tickValueLoss ?? symbol.tickValue),
    tickValueLossPerLot: Number(symbol.tickValueLoss ?? symbol.tickValue),
    tickValueProfitPerLot: Number(symbol.tickValueProfit ?? symbol.tickValue),
    contractSize: Number(symbol.contractSize),
    digits: Number(symbol.digits),
  };
}
function assertConnectorConnected(account = {}) {
  const brokerAccountId = brokerAccountIdOf(account);
  const status = text(providerConfigOf(account).status).toLowerCase();
  if (!brokerAccountId || brokerAccountId.toLowerCase().startsWith('pending:') || status !== 'connected') {
    const error = new Error('MT5 connector trade account is not synchronized and connected');
    error.code = 'MT5_CONNECTOR_NOT_CONNECTED';
    throw error;
  }
}
function deliveryStoreFor({ factory, supabase, workspaceId, account, tradingEventId, groupId }) {
  const id = accountRef(account);
  const base = factory(supabase, {
    workspaceId,
    destinationType: 'mt5',
    destinationRef: `trade-account:${id}`,
    tradingEventId: tradingEventId || null,
  });
  return createContextualDeliveryStore(base, {
    accountId: id,
    groupId: text(groupId) || null,
    destinationType: 'mt5',
  });
}
async function readJson(response, reason) {
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok || body?.ok === false) {
    const error = new Error(reason);
    error.code = text(body?.reason) || 'MT5_CONNECTOR_CONTEXT_UNAVAILABLE';
    throw error;
  }
  return body;
}

export function createProductionExecutionDependencies(config = {}, overrides = {}) {
  const { env = {}, supabase, workspaceId, tradingEventId = null } = config;
  const boundWorkspaceId = text(workspaceId);
  if (!boundWorkspaceId) throw new TypeError('workspaceId is required');
  const decryptCredentialsFn = overrides.decryptCredentialsFn || decryptConnectionCredentials;
  const deliveryStoreFactory = overrides.deliveryStoreFactory || createSupabaseDeliveryStore;
  const mt5ConnectorExecutor = overrides.mt5ConnectorExecutor || executeMt5ConnectorAction;
  const fetchFn = overrides.fetchFn || fetch;
  const exposureLoader = overrides.exposureLoader || null;
  const base = createLegacyProductionExecutionDependencies(config, overrides);

  async function credentials(account) {
    const masterKey = text(env.TRADING_MASTER_KEY);
    if (!masterKey) throw new Error('TRADING_MASTER_KEY is not configured');
    const ciphertext = text(account.credential_ciphertext ?? account.credentialCiphertext);
    if (!ciphertext) throw new Error('trade account credential_ciphertext is not configured');
    try {
      return await decryptCredentialsFn('mt5_connector', ciphertext, masterKey);
    } catch {
      throw new Error('production broker credentials are unavailable');
    }
  }

  async function loadExposure(account, action) {
    if (typeof exposureLoader === 'function') {
      const result = await exposureLoader({ workspaceId: boundWorkspaceId, tradingEventId: text(tradingEventId) || null, account, action });
      const daily = Number(result?.currentDailyPnlPercent);
      const open = Number(result?.currentOpenRiskPercent);
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

  async function connectorRiskMaterializer({ workspaceId: requestedWorkspaceId, account, action } = {}) {
    if (text(requestedWorkspaceId) !== boundWorkspaceId || workspaceOf(account) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    assertConnectorConnected(account);
    const cfg = providerConfigOf(account);
    const { catalog, aliases } = accountSymbolCatalogFromProviderConfig(cfg);
    const resolved = resolveAccountSymbol(action?.symbol, catalog, aliases);
    if (!resolved?.ok) {
      const error = new Error(`broker risk context unavailable: ${resolved?.reason || 'symbol resolution failed'}`);
      error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
      throw error;
    }
    const secret = await credentials(account);
    const gatewayUrl = text(secret.gatewayUrl).replace(/\/+$/, '');
    const controlSecret = text(secret.controlSecret);
    if (!gatewayUrl || !controlSecret) throw new Error('MT5 connector gateway credentials are unavailable');
    const response = await fetchFn(`${gatewayUrl}/v1/mt5-context/${encodeURIComponent(accountRef(account))}?symbol=${encodeURIComponent(resolved.platformSymbol)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await readJson(response, 'MT5 connector risk context unavailable');
    const context = body?.context || {};
    const actualAccount = text(context?.account?.accountNumber);
    if (!actualAccount || actualAccount !== brokerAccountIdOf(account)) {
      const error = new Error('MT5 connector account does not match configured trade account');
      error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
      throw error;
    }
    const expectedServer = text(account.server_name ?? account.serverName);
    if (expectedServer && text(context?.account?.serverName) !== expectedServer) {
      const error = new Error('MT5 connector server does not match configured trade account');
      error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
      throw error;
    }
    const exposure = await loadExposure(account, action);
    return validateProductionRiskAction({
      account,
      action,
      brokerAccount: context.account || {},
      instrument: instrumentForRisk(context.symbol || resolved),
      currentMarketPrice: currentEntryPrice(action, context.tick || {}),
      exposure,
    });
  }

  async function riskMaterializer(input = {}) {
    const account = input.account || {};
    if (providerModeOf(account) === 'mt5_connector' && isRiskSizedOpen(account, input.action || {})) {
      return connectorRiskMaterializer(input);
    }
    return base.riskMaterializer(input);
  }

  async function dispatchAction(input = {}) {
    const account = input.account || {};
    if (providerModeOf(account) !== 'mt5_connector') return base.dispatchAction(input);
    if (text(input.workspaceId) !== boundWorkspaceId || workspaceOf(account) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    assertConnectorConnected(account);
    const secret = await credentials(account);
    const cfg = providerConfigOf(account);
    const { catalog, aliases } = accountSymbolCatalogFromProviderConfig(cfg);
    const deliveryStore = deliveryStoreFor({
      factory: deliveryStoreFactory,
      supabase,
      workspaceId: boundWorkspaceId,
      account,
      tradingEventId: text(tradingEventId) || null,
      groupId: input.groupId,
    });
    return mt5ConnectorExecutor(input.action, {
      workspaceId: boundWorkspaceId,
      accountRowId: accountRef(account),
      gatewayUrl: secret.gatewayUrl,
      controlSecret: secret.controlSecret,
      symbolCatalog: catalog,
      symbolAliases: aliases,
      deliveryStore,
      fetchFn,
    });
  }

  return { ...base, riskMaterializer, dispatchAction };
}
