import { createCTraderRuntime } from '../adapters/ctrader_runtime.js';
import { resolveSymbolAgainstCatalog, normalizePrice } from '../normalization/trading_normalizer.js';

const REQUIRED_ENV = [
  'CTRADER_CLIENT_ID',
  'CTRADER_CLIENT_SECRET',
  'CTRADER_ACCESS_TOKEN',
  'CTRADER_ACCOUNT_ID',
];

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function positiveNumber(value, name) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new TypeError(`${name} must be positive`);
  return numeric;
}

function approximatelyInteger(value, epsilon = 1e-8) {
  return Math.abs(value - Math.round(value)) <= epsilon;
}

export function validateCTraderDemoEnvironment(env = {}) {
  const missing = REQUIRED_ENV.filter((name) => String(env[name] ?? '').trim() === '');
  const accountId = Number(env.CTRADER_ACCOUNT_ID);
  if (!missing.includes('CTRADER_ACCOUNT_ID') && !Number.isInteger(accountId)) missing.push('CTRADER_ACCOUNT_ID');
  return {
    ok: missing.length === 0,
    environment: 'demo',
    missing: [...new Set(missing)].sort(),
    configured: REQUIRED_ENV.filter((name) => !missing.includes(name)),
    orderTestEnabled: enabled(env.CTRADER_DEMO_ORDER_TEST),
  };
}

export async function probeCTraderDemo({
  env = {},
  deliveryStore,
  runtimeFactory = createCTraderRuntime,
  quoteTimeoutMs = 10000,
} = {}) {
  const readiness = validateCTraderDemoEnvironment(env);
  if (!readiness.ok) return { ready: false, reason: 'MISSING_CTRADER_DEMO_ENV', missing: readiness.missing };
  if (!deliveryStore?.reserve || !deliveryStore?.complete || !deliveryStore?.fail) {
    throw new TypeError('deliveryStore reserve/complete/fail required');
  }

  const runtime = await runtimeFactory({
    environment: 'demo',
    allowLiveTrading: false,
    clientId: env.CTRADER_CLIENT_ID,
    clientSecret: env.CTRADER_CLIENT_SECRET,
    accessToken: env.CTRADER_ACCESS_TOKEN,
    accountId: Number(env.CTRADER_ACCOUNT_ID),
    deliveryStore,
    requestTimeoutMs: Number(env.CTRADER_DEMO_REQUEST_TIMEOUT_MS || quoteTimeoutMs),
  });

  try {
    if (runtime?.environment !== 'demo') throw new Error('cTrader acceptance runtime must be demo');
    if (!runtime?.account?.canOpenTrades) throw new Error('cTrader demo account cannot open trades');

    const requested = String(env.CTRADER_DEMO_SYMBOL || 'XAUUSD');
    const symbol = resolveSymbolAgainstCatalog(requested, runtime.catalog || []);
    if (!symbol.ok) throw new Error(`cTrader demo symbol resolution failed: ${symbol.reason}`);

    await runtime.marketData.subscribeQuotes([Number(symbol.platformId)]);
    const spot = await runtime.session.waitForEvent((message) => (
      Number(message?.payloadType) === 2131
      && Number(message?.payload?.symbolId) === Number(symbol.platformId)
    ), { timeoutMs: Number(quoteTimeoutMs) });
    runtime.marketData.handleSpotEvent(spot);
    const quote = runtime.marketData.quoteFor(symbol.platformId);
    if (!quote || (!Number.isFinite(Number(quote.bid)) && !Number.isFinite(Number(quote.ask)))) {
      throw new Error('cTrader demo quote unavailable');
    }

    return {
      ready: true,
      environment: 'demo',
      account: {
        accountType: runtime.account.accountType,
        accessRights: runtime.account.accessRights,
        canOpenTrades: Boolean(runtime.account.canOpenTrades),
      },
      symbol: {
        canonical: symbol.canonical,
        platformSymbol: symbol.platformSymbol,
        platformId: symbol.platformId,
        digits: symbol.digits,
        tickSize: symbol.tickSize,
        pipSize: symbol.pipSize,
        protocolLotSize: symbol.protocolLotSize,
        minVolume: symbol.minVolume,
        maxVolume: symbol.maxVolume,
        stepVolume: symbol.stepVolume,
      },
      quote: {
        bid: quote.bid ?? null,
        ask: quote.ask ?? null,
        timestamp: quote.timestamp ?? null,
      },
      orderTestEnabled: readiness.orderTestEnabled,
    };
  } finally {
    runtime?.close?.();
  }
}

export function buildCTraderDemoMarketAction({
  env = {},
  symbol,
  quote,
  side = 'BUY',
  runId = `run-${Date.now()}`,
} = {}) {
  if (!enabled(env.CTRADER_DEMO_ORDER_TEST)) {
    throw new Error('cTrader demo order test must be explicitly enabled');
  }
  if (!symbol?.canonical || !Number.isFinite(Number(symbol.protocolLotSize))) {
    throw new TypeError('resolved cTrader symbol metadata required');
  }

  const normalizedSide = String(side).trim().toUpperCase();
  if (!['BUY', 'SELL'].includes(normalizedSide)) throw new TypeError('side must be BUY or SELL');

  const lots = positiveNumber(env.CTRADER_DEMO_TEST_LOTS, 'CTRADER_DEMO_TEST_LOTS');
  const protocolLotSize = positiveNumber(symbol.protocolLotSize, 'protocolLotSize');
  const protocolVolume = lots * protocolLotSize;
  const minVolume = Number(symbol.minVolume ?? 1);
  const maxVolume = Number(symbol.maxVolume ?? Number.POSITIVE_INFINITY);
  const stepVolume = positiveNumber(symbol.stepVolume ?? 1, 'stepVolume');

  if (protocolVolume < minVolume - 1e-8) {
    throw new RangeError('requested demo lots are below broker minimum');
  }
  if (protocolVolume > maxVolume + 1e-8) {
    throw new RangeError('requested demo lots exceed broker maximum');
  }
  if (!approximatelyInteger(protocolVolume / stepVolume)) {
    throw new RangeError('requested demo lots do not match broker volume step');
  }

  const tickSize = positiveNumber(symbol.tickSize, 'tickSize');
  const reference = Number(normalizedSide === 'BUY' ? quote?.ask : quote?.bid);
  if (!Number.isFinite(reference)) throw new TypeError(`live ${normalizedSide === 'BUY' ? 'ask' : 'bid'} quote required`);

  const stopTicks = positiveNumber(env.CTRADER_DEMO_STOP_TICKS || 100, 'CTRADER_DEMO_STOP_TICKS');
  const targetTicks = positiveNumber(env.CTRADER_DEMO_TARGET_TICKS || 150, 'CTRADER_DEMO_TARGET_TICKS');
  const stopLoss = normalizePrice(
    normalizedSide === 'BUY' ? reference - stopTicks * tickSize : reference + stopTicks * tickSize,
    symbol,
  );
  const takeProfit = normalizePrice(
    normalizedSide === 'BUY' ? reference + targetTicks * tickSize : reference - targetTicks * tickSize,
    symbol,
  );

  return {
    type: 'OPEN_POSITION',
    side: normalizedSide,
    orderType: 'MARKET',
    symbol: symbol.canonical,
    entry: { kind: 'MARKET' },
    lots,
    stopLoss,
    takeProfit,
    idempotencyKey: `ctrader-demo:${runId}:open`,
  };
}
