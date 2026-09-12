import innerWorker from './v1_connections_entry.js';
import { resolveTradingAccessRuntimeControl } from './persistence/supabase_runtime_control_store.js';
import { tradingAccessDisabledResponse } from './security/trading_runtime_access.js';

export { MTProtoListenerNode, TradeStateNode, MtprotoContainerRuntime } from './v1_connections_entry.js';

async function createSupabase(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_CREDENTIALS_REQUIRED');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

function tradingRuntimeUnavailableResponse() {
  return new Response(JSON.stringify({ ok: false, reason: 'TRADING_RUNTIME_CONTROL_UNAVAILABLE' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function requiresTradingRuntimeGate(pathname = '') {
  const path = String(pathname || '');
  if (path === '/api/v1/events') return true;
  if (path.startsWith('/api/v1/admin/')) return true;
  if (path.startsWith('/api/v1/external/')) return true;
  if (path.startsWith('/api/v1/webhooks/')) return true;
  return false;
}

export function createRuntimeControlledTradingEntrypoint({
  base = innerWorker,
  supabaseFactory = createSupabase,
  tradingAccessResolver = resolveTradingAccessRuntimeControl,
} = {}) {
  async function authorizedEnv(env = {}) {
    let supabase;
    try {
      supabase = await supabaseFactory(env);
    } catch {
      return { ok: false, response: tradingRuntimeUnavailableResponse() };
    }

    let control;
    try {
      control = await tradingAccessResolver({ env, supabase });
    } catch {
      control = { ok: false, enabled: false };
    }
    if (!control?.ok) return { ok: false, response: tradingRuntimeUnavailableResponse() };
    if (control.enabled !== true) return { ok: false, response: tradingAccessDisabledResponse() };

    // Legacy inner guards remain compatibility assertions only. Persisted DB state
    // above is the operational authority, so no deployment toggle is required.
    return { ok: true, env: { ...env, TRADING_ACCESS_ENABLED: 'true' } };
  }

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (!requiresTradingRuntimeGate(url.pathname)) return base.fetch(request, env, ctx);
      const runtime = await authorizedEnv(env);
      if (!runtime.ok) return runtime.response;
      return base.fetch(request, runtime.env, ctx);
    },

    async queue(batch, env, ctx) {
      if (typeof base.queue !== 'function') return undefined;
      // Queue work may continue canonicalization while the global switch is OFF;
      // broker execution itself independently re-checks the DB switch fail-closed.
      return base.queue(batch, env, ctx);
    },

    async scheduled(event, env, ctx) {
      if (typeof base.scheduled !== 'function') return undefined;
      return base.scheduled(event, env, ctx);
    },
  };
}

export default createRuntimeControlledTradingEntrypoint();
