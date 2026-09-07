import { decryptConnectionCredentials } from '../security/connection_credentials.js';
import { createSupabaseDeliveryStore } from '../persistence/supabase_delivery_store.js';
import { executeMT5Action } from '../adapters/mt5_executor_v2.js';
import { signMT5MetadataRequest } from '../adapters/mt5_bridge_protocol.js';
import { createCTraderRuntime } from '../adapters/ctrader_runtime.js';
import { fromMT5Symbols } from '../normalization/symbol_catalog.js';
import { resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';
import { createContextualDeliveryStore } from './destination_retry_composition.js';
import { createProductionExecutionAuthorityLoader } from './production_execution_authority.js';
import { validateProductionRiskAction } from './production_risk_authority.js';
import { createRuntimeExecutionSnapshotCache } from './runtime_execution_snapshot.js';

function text(value) {
  return String(value ?? '').trim();
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase());
}

function required(value, name) {
  if (!text(value)) throw new Error(`${name} is not configured`);
  return value;
}

function workspaceOf(account = {}) {
  return text(account.workspace_id ?? account.workspaceId);
}

function accountRef(account = {}) {
  return text(account.id ?? account.accountId ?? account.account_id);
}

function platformOf(account = {}) {
  return text(account.platform).toLowerCase();
}

function brokerAccountIdOf(account = {}) {
  return text(account.account_id ?? account.brokerAccountId);
}

function sizingModeOf(account = {}) {
  return text(account.sizingMode ?? account.sizing_mode).toUpperCase();
}

function safetyPolicyOf(account = {}) {
  const policy = account.safety_policy ?? account.safetyPolicy;
  return policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {};
}

function configuredPositive(policy = {}, name) {
  const value = Number(policy?.[name]);
  return Number.isFinite(value) && value > 0;
}

function requiresDynamicExposure(account = {}) {
  const policy = safetyPolicyOf(account);
  return configuredPositive(policy, 'maxDailyLossPercent') || configuredPositive(policy, 'maxOpenRiskPercent');
}

function snapshotStaticConfig(account = {}) {
  return {
    platform: platformOf(account),
    serverName: text(account.server_name ?? account.serverName),
    sizingMode: sizingModeOf(account),
    fastEntryPolicy: text(account.fast_entry_policy ?? account.fastEntryPolicy).toUpperCase(),
    entryZonePolicy: text(account.entry_zone_policy ?? account.entryZonePolicy).toUpperCase(),
  };
}

function snapshotVersion(config = {}) {
  return [
    'v1',
    text(config.platform),
    text(config.serverName),
    text(config.sizingMode),
    text(config.fastEntryPolicy),
    text(config.entryZonePolicy),
  ].join('|');
}

function stateBindingPayload(binding = {}) {
  const payload = {};
  if (binding.brokerPositionId != null && text(binding.brokerPositionId)) {
    payload.brokerPositionId = String(binding.brokerPositionId);
  }
  if (binding.brokerOrderId != null && text(binding.brokerOrderId)) {
    payload.brokerOrderId = String(binding.brokerOrderId);
  }
  if (binding.brokerDealId != null && text(binding.brokerDealId)) {
    payload.brokerDealId = String(binding.brokerDealId);
  }
  const fillPrice = Number(binding.fillPrice);
  if (Number.isFinite(fillPrice)) payload.fillPrice = fillPrice;
  return payload;
}

function normalizedBaseUrl(value) {
  const raw = text(value).replace(/\/+$/, '');
  if (!raw) throw new Error('MT5_BRIDGE_URL is not configured');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('MT5_BRIDGE_URL is invalid');
  }
  if (parsed.protocol !== 'https:') throw new Error('MT5_BRIDGE_URL must use https');
  return parsed.toString().replace(/\/$/, '');
}

async function readJson(response, label) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
  if (!response.ok || body?.ok === false) throw new Error(`${label} request failed`);
  return body;
}

function accountIdentity(body = {}) {
  return text(
    body?.account_id ??
    body?.accountId ??
    body?.login ??
    body?.account?.account_id ??
    body?.account?.accountId ??
    body?.account?.login,
  );
}

function accountServer(body = {}) {
  return text(
    body?.server_name ??
    body?.serverName ??
    body?.server ??
    body?.account?.server_name ??
    body?.account?.serverName ??
    body?.account?.server,
  );
}

function symbolRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.symbols)) return body.symbols;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function tickPrice(body = {}) {
  for (const value of [body?.ask, body?.bid, body?.last, body?.tick?.ask, body?.tick?.bid, body?.tick?.last]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

async function defaultMt5ContextLoader({ bridgeUrl, bridgeSecret, accountId, serverName, fetchFn = fetch } = {}) {
  const baseUrl = normalizedBaseUrl(bridgeUrl);
  const secret = required(bridgeSecret, 'MT5_BRIDGE_SECRET');
  const request = async (path, label) => {
    const timestamp = String(Date.now());
    const signature = await signMT5MetadataRequest({ method: 'GET', target: path, timestamp, secret });
    let response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Mkety-Timestamp': timestamp,
          'X-Mkety-Signature': signature,
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error(`${label} request failed`);
    }
    return readJson(response, label);
  };

  await request('/v1/health', 'MT5 bridge health');
  const account = await request('/v1/account', 'MT5 bridge account');
  const observedAccountId = accountIdentity(account);
  if (!observedAccountId || observedAccountId !== text(accountId)) {
    throw new Error('MT5 bridge account does not match configured trade account');
  }

  const expectedServer = text(serverName);
  if (expectedServer) {
    const observedServer = accountServer(account);
    if (!observedServer || observedServer !== expectedServer) {
      throw new Error('MT5 bridge server does not match configured trade account');
    }
  }

  const symbols = symbolRows(await request('/v1/symbols', 'MT5 bridge symbols'));
  const catalog = fromMT5Symbols(symbols);
  if (catalog.length === 0) throw new Error('MT5 bridge returned no enabled trading symbols');

  return {
    baseUrl,
    commandUrl: `${baseUrl}/v1/command`,
    brokerAccount: account,
    catalog,
    async marketPriceFor(platformSymbol) {
      const symbol = text(platformSymbol);
      if (!symbol) throw new Error('MT5 market-price symbol is required');
      const body = await request(`/v1/tick?symbol=${encodeURIComponent(symbol)}`, 'MT5 bridge tick');
      const price = tickPrice(body);
      if (!(price > 0)) throw new Error('MT5 bridge returned no reliable market price');
      return price;
    },
  };
}

function deliveryStoreFor({ factory, supabase, workspaceId, account, tradingEventId, groupId }) {
  const platform = platformOf(account);
  const id = accountRef(account);
  if (!platform || !id) throw new Error('production trade account destination identity is incomplete');
  const baseStore = factory(supabase, {
    workspaceId,
    destinationType: platform,
    destinationRef: `trade-account:${id}`,
    tradingEventId: tradingEventId || null,
  });
  return createContextualDeliveryStore(baseStore, {
    accountId: id,
    groupId: text(groupId) || null,
    destinationType: platform,
  });
}

function assertBoundAccount(account, workspaceId) {
  if (!account || typeof account !== 'object') throw new Error('production trade account is required');
  if (workspaceOf(account) !== workspaceId) throw new Error('production execution workspace mismatch');
  if (!accountRef(account)) throw new Error('production trade account id is required');
}

function currentEntryPrice(action = {}) {
  if (action?.entry?.kind === 'PRICE') {
    const value = Number(action.entry.value);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const value = Number(action.entryPrice);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function createProductionExecutionDependencies({
  env = {},
  supabase,
  workspaceId,
  tradingEventId = null,
} = {}, {
  decryptCredentialsFn = decryptConnectionCredentials,
  deliveryStoreFactory = createSupabaseDeliveryStore,
  mt5ContextLoader = defaultMt5ContextLoader,
  mt5Executor = executeMT5Action,
  ctraderRuntimeFactory = createCTraderRuntime,
  exposureLoader = null,
  executionSnapshotCache = createRuntimeExecutionSnapshotCache(),
  fetchFn = fetch,
} = {}) {
  const boundWorkspaceId = text(workspaceId);
  const boundTradingEventId = text(tradingEventId);
  if (!boundWorkspaceId) throw new TypeError('workspaceId is required');
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  if (typeof decryptCredentialsFn !== 'function') throw new TypeError('decryptCredentialsFn is required');
  if (typeof deliveryStoreFactory !== 'function') throw new TypeError('deliveryStoreFactory is required');
  if (!executionSnapshotCache?.get || !executionSnapshotCache?.put) {
    throw new TypeError('executionSnapshotCache is required');
  }

  const mt5ActionContexts = new Map();
  const mt5ContextTtlMs = 15000;
  const mt5ContextMaxEntries = 64;
  const ctraderBatchRuntimes = new Map();
  const ctraderBatchMaxEntries = 32;

  function mt5ActionContextKey(account, action) {
    const idempotencyKey = text(action?.idempotencyKey);
    if (!idempotencyKey) return '';
    return `${boundWorkspaceId}|${accountRef(account)}|${brokerAccountIdOf(account)}|${idempotencyKey}`;
  }

  function purgeMt5ActionContexts(now = Date.now()) {
    for (const [key, entry] of mt5ActionContexts) {
      if (!entry || now - entry.createdAt > mt5ContextTtlMs) mt5ActionContexts.delete(key);
    }
    while (mt5ActionContexts.size > mt5ContextMaxEntries) {
      const oldest = mt5ActionContexts.keys().next().value;
      if (oldest == null) break;
      mt5ActionContexts.delete(oldest);
    }
  }

  function rememberMt5ActionContext(account, action, context) {
    const key = mt5ActionContextKey(account, action);
    if (!key || !context) return;
    purgeMt5ActionContexts();
    mt5ActionContexts.delete(key);
    mt5ActionContexts.set(key, { context, createdAt: Date.now() });
    purgeMt5ActionContexts();
  }

  function consumeMt5ActionContext(account, action) {
    purgeMt5ActionContexts();
    const key = mt5ActionContextKey(account, action);
    if (!key) return null;
    const entry = mt5ActionContexts.get(key);
    mt5ActionContexts.delete(key);
    return entry?.context || null;
  }

  function ctraderBatchKey(account, brokerAccountId, environment, groupId) {
    const group = text(groupId);
    if (!group) return '';
    return `${boundWorkspaceId}|${accountRef(account)}|${text(brokerAccountId)}|${text(environment).toLowerCase()}|${group}`;
  }

  async function closeCTraderRuntime(runtime) {
    if (!runtime?.close) return;
    try {
      await runtime.close();
    } catch {}
  }

  async function trimCTraderBatchRuntimes() {
    while (ctraderBatchRuntimes.size > ctraderBatchMaxEntries) {
      const oldestKey = ctraderBatchRuntimes.keys().next().value;
      if (oldestKey == null) break;
      const entry = ctraderBatchRuntimes.get(oldestKey);
      ctraderBatchRuntimes.delete(oldestKey);
      await closeCTraderRuntime(entry?.runtime);
    }
  }

  async function finalizeExecutionBatch() {
    const entries = [...ctraderBatchRuntimes.values()];
    ctraderBatchRuntimes.clear();
    await Promise.all(entries.map(async (entry) => closeCTraderRuntime(entry?.runtime)));
  }

  async function loadAccountCredentials(account, expectedPlatform) {
    assertBoundAccount(account, boundWorkspaceId);
    const platform = platformOf(account);
    if (platform !== expectedPlatform) throw new Error('production broker credential platform mismatch');
    const masterKey = required(env.TRADING_MASTER_KEY, 'TRADING_MASTER_KEY');
    const ciphertext = required(
      account.credential_ciphertext ?? account.credentialCiphertext,
      'trade account credential_ciphertext',
    );
    try {
      return await decryptCredentialsFn(expectedPlatform, ciphertext, masterKey);
    } catch {
      throw new Error('production broker credentials are unavailable');
    }
  }

  let authorityLoaderImpl = null;
  async function authorityLoader(input = {}) {
    if (!boundTradingEventId) {
      const error = new Error('production execution trading event authority unavailable');
      error.code = 'EXECUTION_AUTHORITY_REVOKED';
      throw error;
    }
    if (!authorityLoaderImpl) {
      authorityLoaderImpl = createProductionExecutionAuthorityLoader({
        supabase,
        workspaceId: boundWorkspaceId,
        tradingEventId: boundTradingEventId,
      });
    }
    return authorityLoaderImpl(input);
  }

  async function accountLoader(requestedWorkspaceId, accountId) {
    if (text(requestedWorkspaceId) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    const id = text(accountId);
    if (!id) throw new TypeError('accountId is required');

    const { data, error } = await supabase
      .from('trade_accounts')
      .select('*')
      .eq('workspace_id', boundWorkspaceId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error('failed to load production trade account');
    return data || null;
  }

  async function snapshotLoader({ workspaceId: requestedWorkspaceId, sourceId, account } = {}) {
    if (text(requestedWorkspaceId) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    assertBoundAccount(account, boundWorkspaceId);
    const trustedSourceId = text(sourceId);
    if (!trustedSourceId) return null;
    const accountId = accountRef(account);
    const config = snapshotStaticConfig(account);
    const version = snapshotVersion(config);
    const identity = {
      workspaceId: boundWorkspaceId,
      sourceId: trustedSourceId,
      accountId,
      version,
    };
    const cached = executionSnapshotCache.get(identity);
    if (cached) return cached;
    return executionSnapshotCache.put({ ...identity, ...config });
  }

  async function loadExposure(account, action) {
    if (typeof exposureLoader === 'function') {
      const exposure = await exposureLoader({
        workspaceId: boundWorkspaceId,
        tradingEventId: boundTradingEventId || null,
        account,
        action,
      });
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

  async function riskMaterializer({ workspaceId: requestedWorkspaceId, account, action } = {}) {
    if (text(requestedWorkspaceId) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    assertBoundAccount(account, boundWorkspaceId);
    if (!action || typeof action !== 'object') throw new TypeError('canonical action is required');

    const exposure = await loadExposure(account, action);
    const platform = platformOf(account);
    const riskSized = ['RISK_PERCENT', 'FIXED_RISK'].includes(sizingModeOf(account));

    if (platform === 'ctrader' && riskSized && String(action.type || '').toUpperCase() === 'OPEN_POSITION') {
      const error = new Error('cTrader broker risk context unavailable: reliable monetary loss model required');
      error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
      throw error;
    }

    if (platform !== 'mt5' || !riskSized || String(action.type || '').toUpperCase() !== 'OPEN_POSITION') {
      return validateProductionRiskAction({
        account,
        action,
        brokerAccount: {},
        instrument: {},
        exposure,
      });
    }

    const credentials = await loadAccountCredentials(account, 'mt5');
    const bridgeUrl = required(credentials.bridgeUrl, 'trade account MT5 bridgeUrl');
    const bridgeSecret = required(credentials.bridgeSecret, 'trade account MT5 bridgeSecret');
    const brokerAccountId = required(brokerAccountIdOf(account), 'trade account account_id');
    const context = await mt5ContextLoader({
      bridgeUrl,
      bridgeSecret,
      accountId: brokerAccountId,
      serverName: text(account.server_name),
      fetchFn,
    });
    const resolved = resolveSymbolAgainstCatalog(action.symbol, Array.isArray(context?.catalog) ? context.catalog : []);
    if (!resolved.ok) {
      const error = new Error(`broker risk context unavailable: ${resolved.reason || 'symbol resolution failed'}`);
      error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
      throw error;
    }

    let marketPrice = currentEntryPrice(action);
    if (!(marketPrice > 0) && typeof context?.marketPriceFor === 'function') {
      marketPrice = await context.marketPriceFor(resolved.platformSymbol);
    }

    const result = validateProductionRiskAction({
      account,
      action,
      brokerAccount: context?.brokerAccount || {},
      instrument: resolved,
      currentMarketPrice: marketPrice,
      exposure,
    });
    if (result?.allowed) rememberMt5ActionContext(account, result.action || action, context);
    return {
      ...result,
      policyRequest: result.policyContext,
    };
  }

  async function dispatchMt5(account, action, groupId) {
    const credentials = await loadAccountCredentials(account, 'mt5');
    const bridgeUrl = required(credentials.bridgeUrl, 'trade account MT5 bridgeUrl');
    const bridgeSecret = required(credentials.bridgeSecret, 'trade account MT5 bridgeSecret');
    const brokerAccountId = required(brokerAccountIdOf(account), 'trade account account_id');
    const deliveryStore = deliveryStoreFor({
      factory: deliveryStoreFactory,
      supabase,
      workspaceId: boundWorkspaceId,
      account,
      tradingEventId: boundTradingEventId || null,
      groupId,
    });

    const context = consumeMt5ActionContext(account, action) || await mt5ContextLoader({
      bridgeUrl,
      bridgeSecret,
      accountId: brokerAccountId,
      serverName: text(account.server_name),
      fetchFn,
    });
    const catalog = Array.isArray(context?.catalog) ? context.catalog : [];
    const commandUrl = text(context?.commandUrl) || `${normalizedBaseUrl(bridgeUrl)}/v1/command`;

    return mt5Executor(action, {
      workspaceId: boundWorkspaceId,
      accountId: brokerAccountId,
      bridgeUrl: commandUrl,
      bridgeSecret,
      catalog,
      deliveryStore,
      fetchFn,
    });
  }

  async function dispatchCTrader(account, action, groupId) {
    const credentials = await loadAccountCredentials(account, 'ctrader');
    const clientId = required(credentials.clientId, 'trade account cTrader clientId');
    const clientSecret = required(credentials.clientSecret, 'trade account cTrader clientSecret');
    const accessToken = required(credentials.accessToken, 'trade account cTrader accessToken');
    const brokerAccountId = required(brokerAccountIdOf(account), 'trade account account_id');
    const numericAccountId = Number(brokerAccountId);
    if (!Number.isInteger(numericAccountId)) throw new Error('trade account account_id must be an integer for cTrader');

    const environment = text(account.server_name).toLowerCase();
    if (!['demo', 'live'].includes(environment)) {
      throw new Error('cTrader trade account server_name must be demo or live');
    }
    const allowLiveTrading = environment === 'live' && enabled(env.CTRADER_LIVE_TRADING_ENABLED);
    if (environment === 'live' && !allowLiveTrading) {
      throw new Error('live cTrader execution is disabled');
    }

    const batchKey = ctraderBatchKey(account, brokerAccountId, environment, groupId);
    let runtime = batchKey ? ctraderBatchRuntimes.get(batchKey)?.runtime : null;

    if (!runtime) {
      const deliveryStore = deliveryStoreFor({
        factory: deliveryStoreFactory,
        supabase,
        workspaceId: boundWorkspaceId,
        account,
        tradingEventId: boundTradingEventId || null,
        groupId,
      });

      runtime = await ctraderRuntimeFactory({
        environment,
        allowLiveTrading,
        clientId,
        clientSecret,
        accessToken,
        accountId: numericAccountId,
        deliveryStore,
      });
      if (!runtime?.execute) {
        await closeCTraderRuntime(runtime);
        throw new Error('cTrader production runtime is unavailable');
      }
      if (batchKey) {
        ctraderBatchRuntimes.set(batchKey, { runtime });
        await trimCTraderBatchRuntimes();
      }
    }

    try {
      return await runtime.execute(action);
    } catch (error) {
      if (batchKey && ctraderBatchRuntimes.get(batchKey)?.runtime === runtime) {
        ctraderBatchRuntimes.delete(batchKey);
      }
      await closeCTraderRuntime(runtime);
      throw error;
    } finally {
      if (!batchKey) await closeCTraderRuntime(runtime);
    }
  }

  async function dispatchAction({ workspaceId: requestedWorkspaceId, groupId, account, action } = {}) {
    if (text(requestedWorkspaceId) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    assertBoundAccount(account, boundWorkspaceId);
    if (!action || typeof action !== 'object') throw new TypeError('canonical action is required');

    const platform = platformOf(account);
    if (platform === 'mt5') return dispatchMt5(account, action, groupId);
    if (platform === 'ctrader') return dispatchCTrader(account, action, groupId);
    throw new Error(`unsupported production broker platform: ${platform || 'unknown'}`);
  }

  async function stateBinder(binding = {}) {
    if (text(binding.workspaceId) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    const groupId = text(binding.groupId);
    const legId = text(binding.legId);
    if (!groupId) throw new TypeError('groupId is required');
    if (!legId) throw new TypeError('legId is required');

    const token = text(env.TRADE_STATE_INTERNAL_TOKEN);
    if (!token) throw new Error('TRADE_STATE_INTERNAL_TOKEN is not configured');
    const namespace = env.TRADE_STATE_NAMESPACE;
    if (!namespace?.idFromName || !namespace?.get) {
      throw new Error('TRADE_STATE_NAMESPACE is not configured');
    }

    const payload = stateBindingPayload(binding);
    if (Object.keys(payload).length === 0) {
      throw new Error('broker execution identifiers are required for Trade State binding');
    }

    const stub = namespace.get(namespace.idFromName(boundWorkspaceId));
    const response = await stub.fetch(
      `https://trade-state.internal/groups/${encodeURIComponent(groupId)}/legs/${encodeURIComponent(legId)}/execution`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mkety-internal-token': token,
        },
        body: JSON.stringify(payload),
      },
    );

    let responseBody = {};
    try {
      responseBody = await response.json();
    } catch {}
    if (!response.ok) {
      throw new Error(`Trade State binding failed (${response.status})`);
    }
    return responseBody;
  }

  return {
    accountLoader,
    authorityLoader,
    snapshotLoader,
    riskMaterializer,
    dispatchAction,
    stateBinder,
    finalizeExecutionBatch,
  };
}

export { defaultMt5ContextLoader };