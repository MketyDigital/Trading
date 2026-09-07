import { CTraderJsonSession } from './ctrader_session.js';
import { CTraderMarketData } from './ctrader_market_data.js';
import { ctraderEndpoint } from './ctrader_protocol.js';
import { executeCTraderAction } from './ctrader_executor_v2.js';

function required(value, name) {
  if (value == null || String(value).trim() === '') throw new TypeError(`${name} is required`);
  return value;
}

export async function createCTraderRuntime({
  environment = 'demo',
  allowLiveTrading = false,
  clientId,
  clientSecret,
  accessToken,
  accountId,
  deliveryStore,
  sessionFactory = (options) => new CTraderJsonSession(options),
  socketFactory,
  requestTimeoutMs,
} = {}) {
  const mode = String(environment || 'demo').toLowerCase();
  if (!['demo', 'live'].includes(mode)) throw new TypeError('cTrader environment must be demo or live');
  if (mode === 'live' && allowLiveTrading !== true) {
    throw new Error('live cTrader runtime is disabled unless explicitly enabled');
  }

  required(clientId, 'clientId');
  required(clientSecret, 'clientSecret');
  required(accessToken, 'accessToken');
  if (!Number.isInteger(Number(accountId))) throw new TypeError('accountId is required');
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) {
    throw new TypeError('deliveryStore reserve/complete/fail required');
  }

  const endpoint = ctraderEndpoint(mode, 'json');
  const session = sessionFactory({
    endpoint,
    clientId: String(clientId),
    clientSecret: String(clientSecret),
    ...(socketFactory ? { socketFactory } : {}),
    ...(requestTimeoutMs != null ? { requestTimeoutMs: Number(requestTimeoutMs) } : {}),
  });

  await session.open();
  await session.authenticateAccount(Number(accountId), String(accessToken));

  const marketData = new CTraderMarketData({ session, accountId: Number(accountId) });
  const account = await marketData.loadAccount();
  if (!account.canOpenTrades) {
    session.close?.();
    throw new Error(`cTrader account does not allow opening trades (${account.accessRights})`);
  }

  const catalog = await marketData.loadCatalog();
  if (!catalog.length) {
    session.close?.();
    throw new Error('cTrader account returned no enabled trading symbols');
  }

  return {
    ready: true,
    environment: mode,
    endpoint,
    session,
    marketData,
    account,
    catalog,
    async execute(action) {
      if (!action) throw new TypeError('canonical action is required');
      return executeCTraderAction(action, {
        session,
        accountId: Number(accountId),
        catalog,
        deliveryStore,
      });
    },
    close() {
      session.close?.();
    },
  };
}
