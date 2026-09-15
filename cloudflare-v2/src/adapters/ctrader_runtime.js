import { CTraderJsonSession } from './ctrader_session.js';
import { CTraderMarketData } from './ctrader_market_data.js';
import { ctraderEndpoint } from './ctrader_protocol.js';
import { executeCTraderAction } from './ctrader_executor_v2.js';
import { resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';
import { evaluateBreakEvenEligibility, isBreakEvenAction } from '../execution/break_even_safety.js';

function required(value, name) {
  if (value == null || String(value).trim() === '') throw new TypeError(`${name} is required`);
  return value;
}

export async function createCTraderRuntime({
  environment = 'demo',
  allowLiveTrading = false,
  allowBrokerMinimumVolumeFallback = false,
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

  async function breakEvenPriceFor(action) {
    const resolved = resolveSymbolAgainstCatalog(action?.symbol, catalog);
    if (!resolved.ok) throw new Error(`cTrader symbol resolution failed: ${resolved.reason}`);
    await marketData.subscribeQuotes([resolved.platformId]);

    const spot = await session.waitForEvent((message) =>
      Number(message?.payloadType) === 2131 &&
      Number(message?.payload?.symbolId) === Number(resolved.platformId),
    { timeoutMs: Number(requestTimeoutMs) || 5000 });
    const quote = marketData.handleSpotEvent(spot) || marketData.quoteFor(resolved.platformId);

    const side = String(action?.side || '').toUpperCase();
    const marketPrice = side === 'BUY' ? Number(quote?.bid) : Number(quote?.ask);
    return Number.isFinite(marketPrice) && marketPrice > 0 ? marketPrice : null;
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
      if (isBreakEvenAction(action)) {
        let marketPrice = null;
        try {
          marketPrice = await breakEvenPriceFor(action);
        } catch {
          marketPrice = null;
        }
        const eligibility = evaluateBreakEvenEligibility({
          side: action.side,
          entryPrice: action.entryPrice,
          marketPrice,
        });
        if (!eligibility.allowed) {
          return {
            ok: false,
            blocked: true,
            code: eligibility.reason,
            entryPrice: eligibility.entryPrice,
            marketPrice: eligibility.marketPrice,
          };
        }
      }
      const demoSyntheticFallback = mode === 'demo' && String(action?.symbol || '').toUpperCase().startsWith('DERIV:');
      return executeCTraderAction(action, {
        session,
        accountId: Number(accountId),
        catalog,
        deliveryStore,
        allowBrokerMinimumVolumeFallback: demoSyntheticFallback || (mode === 'demo' && allowBrokerMinimumVolumeFallback === true),
      });
    },
    close() {
      session.close?.();
    },
  };
}
