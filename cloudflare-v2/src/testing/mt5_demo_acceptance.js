import { fromMT5Symbols } from '../normalization/symbol_catalog.js';
import { resolveSymbolAgainstCatalog } from '../normalization/trading_normalizer.js';

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
