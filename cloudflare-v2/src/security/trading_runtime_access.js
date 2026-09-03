const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isTradingAccessEnabled(env = {}) {
  return ENABLED_VALUES.has(String(env?.TRADING_ACCESS_ENABLED ?? '').trim().toLowerCase());
}

export function tradingAccessDisabledResponse() {
  return new Response(JSON.stringify({ ok: false, reason: 'TRADING_ACCESS_DISABLED' }), {
    status: 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
