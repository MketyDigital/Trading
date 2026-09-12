import { resolveTradingAccessRuntimeControl } from '../persistence/supabase_runtime_control_store.js';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isTradingAccessEnabled(env = {}) {
  return ENABLED_VALUES.has(String(env?.TRADING_ACCESS_ENABLED ?? '').trim().toLowerCase());
}

async function defaultSupabaseFactory(env = {}) {
  const url = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

export async function resolveGlobalTradingAccess(env = {}, { supabase = null, supabaseFactory = defaultSupabaseFactory } = {}) {
  let client = supabase;
  if (!client) {
    try { client = await supabaseFactory(env); } catch { return { ok: false, enabled: false, reason: 'TRADING_RUNTIME_CONTROL_UNAVAILABLE' }; }
  }
  if (!client?.from) {
    return { ok: true, enabled: isTradingAccessEnabled(env), bootstrapFallback: true };
  }
  const control = await resolveTradingAccessRuntimeControl({ supabase: client });
  if (!control?.ok) return { ok: false, enabled: false, reason: 'TRADING_RUNTIME_CONTROL_UNAVAILABLE' };
  return control;
}

export function tradingAccessDisabledResponse(reason = 'TRADING_ACCESS_DISABLED') {
  return new Response(JSON.stringify({ ok: false, reason }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
