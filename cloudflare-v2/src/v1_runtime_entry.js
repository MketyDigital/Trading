import innerWorker from './v1_connections_entry.js';
import { createTradingConnectionsEntrypoint } from './v1_connections_entry.js';
import { resolveTradingAccessRuntimeControl } from './persistence/supabase_runtime_control_store.js';
import { tradingAccessDisabledResponse } from './security/trading_runtime_access.js';
import { createTradingPersistenceRuntime } from './persistence/trading_persistence_runtime.js';

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
  base = null,
  supabaseFactory = createSupabase,
  tradingAccessResolver = resolveTradingAccessRuntimeControl,
  persistenceRuntimeFactory = null,
  persistenceRuntimeEnabled = (env = {}) => /^(1|true|yes|on)$/i.test(String(env.TRADING_STORAGE_RUNTIME_ENABLED || '').trim()),
} = {}) {
  const runtimeFactory = persistenceRuntimeFactory;
  const usePersistenceRuntime = (env = {}) => Boolean(runtimeFactory && persistenceRuntimeEnabled(env));
  const activeBase = base || (runtimeFactory
    ? createTradingConnectionsEntrypoint({ persistenceRuntimeFactory: runtimeFactory, persistenceRuntimeEnabled })
    : innerWorker);
  async function legacyAuthorizedEnv(env = {}) {
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
      if (!requiresTradingRuntimeGate(url.pathname)) return activeBase.fetch(request, env, ctx);
      if (usePersistenceRuntime(env)) {
        let persistenceRuntime;
        try {
          persistenceRuntime = await runtimeFactory(env);
          const control = await tradingAccessResolver({ env, runtimeControls: persistenceRuntime.runtimeControls });
          if (!control?.ok) return tradingRuntimeUnavailableResponse();
          if (control.enabled !== true) return tradingAccessDisabledResponse();
          const requestCtx = Object.assign(Object.create(ctx ? Object.getPrototypeOf(ctx) : Object.prototype), ctx || {}, { tradingPersistenceRuntime: persistenceRuntime });
          return await activeBase.fetch(request, { ...env, TRADING_ACCESS_ENABLED: 'true' }, requestCtx);
        } catch {
          return tradingRuntimeUnavailableResponse();
        } finally {
          try { await persistenceRuntime?.close?.(); } catch { /* Preserve the request response. */ }
        }
      }
      const runtime = await legacyAuthorizedEnv(env);
      if (!runtime.ok) return runtime.response;
      return activeBase.fetch(request, runtime.env, ctx);
    },

    async queue(batch, env, ctx) {
      if (typeof activeBase.queue !== 'function') return undefined;
      // Queue work may continue canonicalization while the global switch is OFF;
      // broker execution itself independently re-checks the DB switch fail-closed.
      return activeBase.queue(batch, env, ctx);
    },

    async scheduled(event, env, ctx) {
      if (typeof activeBase.scheduled !== 'function') return undefined;
      return activeBase.scheduled(event, env, ctx);
    },
  };
}

export default createRuntimeControlledTradingEntrypoint({
  persistenceRuntimeFactory: createTradingPersistenceRuntime,
});
