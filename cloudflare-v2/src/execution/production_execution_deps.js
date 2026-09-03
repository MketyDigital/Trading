import { decryptSecret } from '../security/secret_box.js';
import { createSupabaseDeliveryStore } from '../persistence/supabase_delivery_store.js';
import { executeMT5Action } from '../adapters/mt5_executor_v2.js';
import { createCTraderRuntime } from '../adapters/ctrader_runtime.js';
import { fromMT5Symbols } from '../normalization/symbol_catalog.js';

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

async function defaultMt5ContextLoader({ bridgeUrl, accountId, serverName, fetchFn = fetch } = {}) {
  const baseUrl = normalizedBaseUrl(bridgeUrl);
  const request = async (path, label) => {
    let response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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
    catalog,
  };
}

function deliveryStoreFor({ factory, supabase, workspaceId, account, tradingEventId }) {
  const platform = platformOf(account);
  const id = accountRef(account);
  if (!platform || !id) throw new Error('production trade account destination identity is incomplete');
  return factory(supabase, {
    workspaceId,
    destinationType: platform,
    destinationRef: `trade-account:${id}`,
    tradingEventId: tradingEventId || null,
  });
}

function assertBoundAccount(account, workspaceId) {
  if (!account || typeof account !== 'object') throw new Error('production trade account is required');
  if (workspaceOf(account) !== workspaceId) throw new Error('production execution workspace mismatch');
  if (!accountRef(account)) throw new Error('production trade account id is required');
}

export function createProductionExecutionDependencies({
  env = {},
  supabase,
  workspaceId,
  tradingEventId = null,
} = {}, {
  decryptFn = decryptSecret,
  deliveryStoreFactory = createSupabaseDeliveryStore,
  mt5ContextLoader = defaultMt5ContextLoader,
  mt5Executor = executeMT5Action,
  ctraderRuntimeFactory = createCTraderRuntime,
  fetchFn = fetch,
} = {}) {
  const boundWorkspaceId = text(workspaceId);
  if (!boundWorkspaceId) throw new TypeError('workspaceId is required');
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  if (typeof deliveryStoreFactory !== 'function') throw new TypeError('deliveryStoreFactory is required');

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

  async function dispatchMt5(account, action) {
    const bridgeUrl = required(env.MT5_BRIDGE_URL, 'MT5_BRIDGE_URL');
    const bridgeSecret = required(env.MT5_BRIDGE_SECRET, 'MT5_BRIDGE_SECRET');
    const brokerAccountId = required(brokerAccountIdOf(account), 'trade account account_id');
    const deliveryStore = deliveryStoreFor({
      factory: deliveryStoreFactory,
      supabase,
      workspaceId: boundWorkspaceId,
      account,
      tradingEventId,
    });

    const context = await mt5ContextLoader({
      bridgeUrl,
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

  async function dispatchCTrader(account, action) {
    const masterKey = required(env.TRADING_MASTER_KEY, 'TRADING_MASTER_KEY');
    const clientId = required(env.CTRADER_CLIENT_ID, 'CTRADER_CLIENT_ID');
    const clientSecret = required(env.CTRADER_CLIENT_SECRET, 'CTRADER_CLIENT_SECRET');
    const encryptedAccessToken = required(account.api_token_encrypted, 'trade account api_token_encrypted');
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

    const accessToken = await decryptFn(encryptedAccessToken, masterKey);
    const deliveryStore = deliveryStoreFor({
      factory: deliveryStoreFactory,
      supabase,
      workspaceId: boundWorkspaceId,
      account,
      tradingEventId,
    });

    let runtime;
    try {
      runtime = await ctraderRuntimeFactory({
        environment,
        allowLiveTrading,
        clientId,
        clientSecret,
        accessToken,
        accountId: numericAccountId,
        deliveryStore,
      });
      if (!runtime?.execute) throw new Error('cTrader production runtime is unavailable');
      return await runtime.execute(action);
    } finally {
      runtime?.close?.();
    }
  }

  async function dispatchAction({ workspaceId: requestedWorkspaceId, account, action } = {}) {
    if (text(requestedWorkspaceId) !== boundWorkspaceId) {
      throw new Error('production execution workspace mismatch');
    }
    assertBoundAccount(account, boundWorkspaceId);
    if (!action || typeof action !== 'object') throw new TypeError('canonical action is required');

    const platform = platformOf(account);
    if (platform === 'mt5') return dispatchMt5(account, action);
    if (platform === 'ctrader') return dispatchCTrader(account, action);
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
    dispatchAction,
    stateBinder,
  };
}

export { defaultMt5ContextLoader };
