import { createTradingConnectionsEntrypoint } from './v1_connections_entry.js';
import { resolveTradingAccessRuntimeControl } from './persistence/supabase_runtime_control_store.js';
import { tradingAccessDisabledResponse } from './security/trading_runtime_access.js';
import { createTradingPersistenceRuntime } from './persistence/trading_persistence_runtime.js';

export { MTProtoListenerNode, TradeStateNode, MtprotoContainerRuntime } from './v1_connections_entry.js';

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
  tradingAccessResolver = resolveTradingAccessRuntimeControl,
  persistenceRuntimeFactory = null,
  persistenceRuntimeEnabled = () => true,
} = {}) {
  const runtimeFactory = persistenceRuntimeFactory;
  const usePersistenceRuntime = (env = {}) => Boolean(runtimeFactory && persistenceRuntimeEnabled(env));
  const activeBase = base || (runtimeFactory
    ? createTradingConnectionsEntrypoint({ persistenceRuntimeFactory: runtimeFactory, persistenceRuntimeEnabled })
    : null);

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (!activeBase) return tradingRuntimeUnavailableResponse();
      if (!requiresTradingRuntimeGate(url.pathname)) {
        if (!usePersistenceRuntime(env)) return tradingRuntimeUnavailableResponse();
        return activeBase.fetch(request, env, ctx);
      }
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
      return tradingRuntimeUnavailableResponse();
    },

    async queue(batch, env, ctx) {
      if (!activeBase || typeof activeBase.queue !== 'function') return undefined;
      // Queue work may continue canonicalization while the global switch is OFF;
      // broker execution itself independently re-checks the DB switch fail-closed.
      return activeBase.queue(batch, env, ctx);
    },

    async scheduled(event, env, ctx) {
      if (!activeBase || typeof activeBase.scheduled !== 'function') return undefined;
      return activeBase.scheduled(event, env, ctx);
    },
  };
}

export default createRuntimeControlledTradingEntrypoint({
  persistenceRuntimeFactory: createTradingPersistenceRuntime,
});
