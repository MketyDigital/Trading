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

function roundLots(value) {
  return Number(Number(value).toFixed(8));
}

function validateCanonicalLots(lots, symbol) {
  const protocolLotSize = positiveNumber(symbol.protocolLotSize, 'protocolLotSize');
  const minVolume = Number(symbol.minVolume ?? 1);
  const maxVolume = Number(symbol.maxVolume ?? Number.POSITIVE_INFINITY);
  const stepVolume = positiveNumber(symbol.stepVolume ?? 1, 'stepVolume');
  const protocolVolume = Number(lots) * protocolLotSize;
  return {
    ok: protocolVolume >= minVolume - 1e-8
      && protocolVolume <= maxVolume + 1e-8
      && approximatelyInteger(protocolVolume / stepVolume),
    minLots: minVolume / protocolLotSize,
    stepLots: stepVolume / protocolLotSize,
  };
}

async function loadDemoQuote(runtime, symbol, quoteTimeoutMs) {
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
  return quote;
}

function createCTraderProbeExecutionDenyStore() {
  const deny = () => {
    throw new Error('cTrader probe execution disabled');
  };
  return Object.freeze({ reserve: deny, complete: deny, fail: deny });
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
  const probeDeliveryStore = deliveryStore?.reserve && deliveryStore?.complete && deliveryStore?.fail
    ? deliveryStore
    : createCTraderProbeExecutionDenyStore();

  const runtime = await runtimeFactory({
    environment: 'demo',
    allowLiveTrading: false,
    clientId: env.CTRADER_CLIENT_ID,
    clientSecret: env.CTRADER_CLIENT_SECRET,
    accessToken: env.CTRADER_ACCESS_TOKEN,
    accountId: Number(env.CTRADER_ACCOUNT_ID),
    deliveryStore: probeDeliveryStore,
    requestTimeoutMs: Number(env.CTRADER_DEMO_REQUEST_TIMEOUT_MS || quoteTimeoutMs),
  });

  try {
    if (runtime?.environment !== 'demo') throw new Error('cTrader acceptance runtime must be demo');
    if (!runtime?.account?.canOpenTrades) throw new Error('cTrader demo account cannot open trades');

    const requested = String(env.CTRADER_DEMO_SYMBOL || 'XAUUSD');
    const symbol = resolveSymbolAgainstCatalog(requested, runtime.catalog || []);
    if (!symbol.ok) throw new Error(`cTrader demo symbol resolution failed: ${symbol.reason}`);

    const quote = await loadDemoQuote(runtime, symbol, quoteTimeoutMs);

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
  const lotValidation = validateCanonicalLots(lots, symbol);
  const protocolVolume = lots * positiveNumber(symbol.protocolLotSize, 'protocolLotSize');
  if (protocolVolume < Number(symbol.minVolume ?? 1) - 1e-8) {
    throw new RangeError('requested demo lots are below broker minimum');
  }
  if (protocolVolume > Number(symbol.maxVolume ?? Number.POSITIVE_INFINITY) + 1e-8) {
    throw new RangeError('requested demo lots exceed broker maximum');
  }
  if (!lotValidation.ok) {
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

export async function runCTraderDemoOrderLifecycle({
  env = {},
  deliveryStore,
  runtimeFactory = createCTraderRuntime,
  quoteTimeoutMs = 10000,
  runId = `run-${Date.now()}`,
  side = 'BUY',
} = {}) {
  const readiness = validateCTraderDemoEnvironment(env);
  if (!readiness.ok) throw new Error(`missing cTrader demo environment: ${readiness.missing.join(', ')}`);
  if (!readiness.orderTestEnabled) throw new Error('cTrader demo order test must be explicitly enabled');
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
    if (typeof runtime?.execute !== 'function') throw new TypeError('cTrader demo runtime execute required');

    const requested = String(env.CTRADER_DEMO_SYMBOL || 'XAUUSD');
    const symbol = resolveSymbolAgainstCatalog(requested, runtime.catalog || []);
    if (!symbol.ok) throw new Error(`cTrader demo symbol resolution failed: ${symbol.reason}`);
    const quote = await loadDemoQuote(runtime, symbol, quoteTimeoutMs);

    const openAction = buildCTraderDemoMarketAction({ env, symbol, quote, side, runId });
    const openResult = await runtime.execute(openAction);
    const brokerPositionId = openResult?.brokerPositionId;
    const brokerOrderId = openResult?.brokerOrderId ?? null;
    const fillPrice = Number(openResult?.fillPrice);
    if (brokerPositionId == null) throw new Error('cTrader demo open did not return broker position id');
    if (!Number.isFinite(fillPrice)) throw new Error('cTrader demo open did not return fill price');

    await runtime.execute({
      type: 'MODIFY_POSITION',
      brokerPositionId,
      symbol: symbol.canonical,
      stopLoss: normalizePrice(fillPrice, symbol),
      idempotencyKey: `ctrader-demo:${runId}:be`,
    });

    const requestedLots = roundLots(openAction.lots);
    const { minLots, stepLots } = validateCanonicalLots(requestedLots, symbol);
    const candidatePartial = roundLots(Math.max(minLots, stepLots));
    const candidateRemaining = roundLots(requestedLots - candidatePartial);
    const canPartial = candidatePartial > 0
      && candidateRemaining > 0
      && validateCanonicalLots(candidatePartial, symbol).ok
      && validateCanonicalLots(candidateRemaining, symbol).ok;

    const steps = ['OPEN_POSITION', 'MOVE_TO_BE'];
    let partialClosedLots = 0;
    let finalClosedLots = requestedLots;

    if (canPartial) {
      partialClosedLots = candidatePartial;
      finalClosedLots = candidateRemaining;
      await runtime.execute({
        type: 'CLOSE_PARTIAL',
        brokerPositionId,
        symbol: symbol.canonical,
        lots: partialClosedLots,
        idempotencyKey: `ctrader-demo:${runId}:partial`,
      });
      steps.push('CLOSE_PARTIAL');
    }

    await runtime.execute({
      type: 'CLOSE_POSITION',
      brokerPositionId,
      symbol: symbol.canonical,
      lots: finalClosedLots,
      idempotencyKey: `ctrader-demo:${runId}:close`,
    });
    steps.push('CLOSE_POSITION');

    return {
      ready: true,
      environment: 'demo',
      symbol: symbol.canonical,
      brokerPositionId,
      brokerOrderId,
      fillPrice,
      requestedLots,
      partialClosedLots,
      finalClosedLots,
      steps,
    };
  } finally {
    runtime?.close?.();
  }
}
