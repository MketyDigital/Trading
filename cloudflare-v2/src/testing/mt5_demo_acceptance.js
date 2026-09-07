import { executeMT5Action } from '../adapters/mt5_executor_v2.js';
import { fromMT5Symbols } from '../normalization/symbol_catalog.js';
import { normalizePrice, resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';

const REQUIRED_ENV = [
  'MT5_BRIDGE_URL',
  'MT5_BRIDGE_SECRET',
  'MT5_ACCOUNT_ID',
  'MT5_DEMO_SERVER',
];

function endpoint(base, path) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`;
  url.search = '';
  return url;
}

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

async function getJson(fetchFn, url, label) {
  const response = await fetchFn(url.toString(), { method: 'GET' });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data?.ok === false) {
    throw new Error(`MT5 demo ${label} unavailable`);
  }
  return data;
}

export function validateMT5DemoEnvironment(env = {}) {
  const missing = REQUIRED_ENV.filter((name) => String(env[name] ?? '').trim() === '');
  return {
    ok: missing.length === 0,
    environment: 'demo',
    missing,
    configured: REQUIRED_ENV.filter((name) => !missing.includes(name)),
  };
}

export async function probeMT5Demo({ env = {}, fetchFn = fetch } = {}) {
  const readiness = validateMT5DemoEnvironment(env);
  if (!readiness.ok) {
    return { ready: false, environment: 'demo', reason: 'MISSING_MT5_DEMO_ENV', missing: readiness.missing };
  }

  const health = await getJson(fetchFn, endpoint(env.MT5_BRIDGE_URL, '/health'), 'bridge health');
  if (!health?.ok) throw new Error('MT5 demo bridge health check failed');

  const accountData = await getJson(fetchFn, endpoint(env.MT5_BRIDGE_URL, '/v1/account'), 'account');
  const account = accountData?.account;
  if (!account) throw new Error('MT5 demo account unavailable');
  if (String(account.login) !== String(env.MT5_ACCOUNT_ID)) {
    throw new Error('MT5 demo account mismatch');
  }
  if (String(account.server) !== String(env.MT5_DEMO_SERVER)) {
    throw new Error('MT5 demo server mismatch');
  }
  if (account.trade_allowed === false) throw new Error('MT5 demo account trading is disabled');

  const symbolsData = await getJson(fetchFn, endpoint(env.MT5_BRIDGE_URL, '/v1/symbols'), 'symbol catalog');
  const catalog = fromMT5Symbols(symbolsData?.symbols || []);
  const requested = String(env.MT5_DEMO_SYMBOL || 'XAUUSD');
  const symbol = resolveSymbolAgainstCatalog(requested, catalog);
  if (!symbol.ok) throw new Error(`MT5 demo symbol resolution failed: ${symbol.reason}`);

  const tickUrl = endpoint(env.MT5_BRIDGE_URL, '/v1/tick');
  tickUrl.searchParams.set('symbol', symbol.platformSymbol);
  const tickData = await getJson(fetchFn, tickUrl, 'tick');
  const tick = tickData?.tick;
  if (!tick || (!Number.isFinite(Number(tick.bid)) && !Number.isFinite(Number(tick.ask)))) {
    throw new Error('MT5 demo tick unavailable');
  }

  return {
    ready: true,
    environment: 'demo',
    account: {
      login: String(account.login),
      server: String(account.server || ''),
      tradeAllowed: account.trade_allowed !== false,
      tradeExpert: account.trade_expert !== false,
      balance: Number.isFinite(Number(account.balance)) ? Number(account.balance) : null,
      equity: Number.isFinite(Number(account.equity)) ? Number(account.equity) : null,
    },
    symbol: {
      canonical: symbol.canonical,
      platformSymbol: symbol.platformSymbol,
      digits: symbol.digits,
      tickSize: symbol.tickSize,
      lotSize: symbol.lotSize,
      minLots: symbol.minLots,
      maxLots: symbol.maxLots,
      stepLots: symbol.stepLots,
    },
    quote: {
      bid: Number.isFinite(Number(tick.bid)) ? Number(tick.bid) : null,
      ask: Number.isFinite(Number(tick.ask)) ? Number(tick.ask) : null,
      timestamp: tick.time_msc ?? tick.time ?? null,
    },
  };
}

export function buildMT5DemoMarketAction({
  env = {},
  symbol,
  quote,
  side = 'BUY',
  runId = `run-${Date.now()}`,
} = {}) {
  if (!enabled(env.MT5_DEMO_ORDER_TEST)) {
    throw new Error('MT5 demo order test must be explicitly enabled');
  }
  if (!symbol?.canonical || !Number.isFinite(Number(symbol.tickSize))) {
    throw new TypeError('resolved MT5 symbol metadata required');
  }

  const normalizedSide = String(side).trim().toUpperCase();
  if (!['BUY', 'SELL'].includes(normalizedSide)) throw new TypeError('side must be BUY or SELL');

  const lots = positiveNumber(env.MT5_DEMO_TEST_LOTS, 'MT5_DEMO_TEST_LOTS');
  const minLots = positiveNumber(symbol.minLots ?? 0.01, 'minLots');
  const maxLots = positiveNumber(symbol.maxLots ?? Number.MAX_SAFE_INTEGER, 'maxLots');
  const stepLots = positiveNumber(symbol.stepLots ?? minLots, 'stepLots');
  if (lots < minLots - 1e-8) throw new RangeError('requested demo lots are below broker minimum');
  if (lots > maxLots + 1e-8) throw new RangeError('requested demo lots exceed broker maximum');
  if (!approximatelyInteger(lots / stepLots)) throw new RangeError('requested demo lots do not match broker volume step');

  const reference = Number(normalizedSide === 'BUY' ? quote?.ask : quote?.bid);
  if (!Number.isFinite(reference)) throw new TypeError(`live ${normalizedSide === 'BUY' ? 'ask' : 'bid'} quote required`);
  const tickSize = positiveNumber(symbol.tickSize, 'tickSize');
  const stopTicks = positiveNumber(env.MT5_DEMO_STOP_TICKS || 100, 'MT5_DEMO_STOP_TICKS');
  const targetTicks = positiveNumber(env.MT5_DEMO_TARGET_TICKS || 150, 'MT5_DEMO_TARGET_TICKS');

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
    idempotencyKey: `mt5-demo:${runId}:open`,
  };
}

export async function runMT5DemoOrderLifecycle({
  env = {},
  deliveryStore,
  fetchFn = fetch,
  probeFn = probeMT5Demo,
  executor = executeMT5Action,
  runId = `run-${Date.now()}`,
} = {}) {
  if (!enabled(env.MT5_DEMO_ORDER_TEST)) {
    throw new Error('MT5 demo order test must be explicitly enabled');
  }

  const probe = await probeFn({ env, fetchFn });
  if (!probe?.ready || probe?.environment !== 'demo') throw new Error('MT5 demo probe is not ready');
  if (String(probe?.account?.login) !== String(env.MT5_ACCOUNT_ID)) throw new Error('MT5 demo account mismatch');
  if (String(probe?.account?.server) !== String(env.MT5_DEMO_SERVER)) throw new Error('MT5 demo server mismatch');

  const openAction = buildMT5DemoMarketAction({ env, symbol: probe.symbol, quote: probe.quote, side: env.MT5_DEMO_SIDE || 'BUY', runId });
  const executorOptions = {
    workspaceId: env.TRADING_WORKSPACE_ID,
    accountId: env.MT5_ACCOUNT_ID,
    bridgeUrl: endpoint(env.MT5_BRIDGE_URL, '/v1/command').toString(),
    bridgeSecret: env.MT5_BRIDGE_SECRET,
    catalog: [probe.symbol],
    deliveryStore,
    fetchFn,
  };

  const opened = await executor(openAction, executorOptions);
  const positionId = opened?.brokerPositionId;
  const fillPrice = Number(opened?.fillPrice);
  if (!positionId) throw new Error('MT5 demo open did not return a position id');
  if (!Number.isFinite(fillPrice)) throw new Error('MT5 demo open did not return actual fill price');

  await executor({
    type: 'MODIFY_POSITION',
    brokerPositionId: String(positionId),
    symbol: probe.symbol.canonical,
    stopLoss: fillPrice,
    idempotencyKey: `mt5-demo:${runId}:be`,
  }, executorOptions);

  const lots = openAction.lots;
  const step = positiveNumber(probe.symbol.stepLots ?? probe.symbol.minLots ?? 0.01, 'stepLots');
  const minLots = positiveNumber(probe.symbol.minLots ?? step, 'minLots');
  const partialLots = lots >= (2 * step) - 1e-8 && step >= minLots - 1e-8 ? step : 0;
  const finalLots = Number((lots - partialLots).toFixed(8));

  if (partialLots > 0) {
    await executor({
      type: 'CLOSE_PARTIAL',
      brokerPositionId: String(positionId),
      symbol: probe.symbol.canonical,
      lots: partialLots,
      idempotencyKey: `mt5-demo:${runId}:partial`,
    }, executorOptions);
  }

  if (finalLots > 0) {
    await executor({
      type: 'CLOSE_POSITION',
      brokerPositionId: String(positionId),
      symbol: probe.symbol.canonical,
      lots: finalLots,
      idempotencyKey: `mt5-demo:${runId}:close`,
    }, executorOptions);
  }

  return {
    environment: 'demo',
    positionId: String(positionId),
    fillPrice,
    partialClosedLots: partialLots,
    finalClosedLots: finalLots,
    symbol: probe.symbol.canonical,
  };
}
