import { createSupabaseTradeStatePersistence } from '../persistence/supabase_trade_state_persistence.js';
import { createProductionExecutionDependencies } from './production_execution_deps_unified.js';
import { createPendingOrderLifecycleRuntime } from './pending_order_lifecycle_runtime.js';

function text(value) { return String(value ?? '').trim(); }

async function applyLifecycleSnapshot(env, input) {
  const token = text(env.TRADE_STATE_INTERNAL_TOKEN);
  const namespace = env.TRADE_STATE_NAMESPACE;
  if (!token || !namespace?.idFromName || !namespace?.get) throw new Error('TRADE_STATE_UNAVAILABLE');
  const workspaceId = text(input.workspaceId);
  const stub = namespace.get(namespace.idFromName(workspaceId));
  const response = await stub.fetch(
    `https://trade-state.internal/groups/${encodeURIComponent(input.groupId)}/legs/${encodeURIComponent(input.legId)}/pending-order-snapshot`,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-mkety-internal-token': token, 'x-mkety-workspace-id': workspaceId },
      body: JSON.stringify(input) },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`TRADE_STATE_${response.status}`);
  return result;
}

export function createProductionPendingOrderLifecycleRuntime({
  persistenceFactory = createSupabaseTradeStatePersistence,
  dependenciesFactory = createProductionExecutionDependencies,
  applySnapshot = applyLifecycleSnapshot,
  clock = Date.now,
} = {}) {
  return async function run(env = {}) {
    if (env.PENDING_ORDER_LIFECYCLE_SYNC_ENABLED !== 'true') return { status: 'disabled', scanned: 0, applied: 0 };
    const persistence = await persistenceFactory(env);
    const rows = await persistence.listPendingOrderLifecycles();
    const dependencyByWorkspace = new Map();
    const runtime = createPendingOrderLifecycleRuntime({
      loadCandidates: async () => rows,
      loadAccount: async (workspaceId, accountId) => {
        if (!dependencyByWorkspace.has(workspaceId)) dependencyByWorkspace.set(workspaceId,
          dependenciesFactory({ env, supabase: persistence.supabase, workspaceId }));
        return dependencyByWorkspace.get(workspaceId).accountLoader(workspaceId, accountId);
      },
      readStatus: async ({ account, lifecycle }) => {
        const deps = dependencyByWorkspace.get(lifecycle.workspaceId);
        return deps.readPendingOrderLifecycleStatus({ workspaceId: lifecycle.workspaceId, account,
          brokerOrderId: lifecycle.brokerOrderId, symbol: lifecycle.symbol });
      },
      applySnapshot: (input) => applySnapshot(env, input),
      clock,
    });
    try {
      return await runtime(env);
    } finally {
      // cTrader OAuth readers keep short-lived broker sessions open while a
      // scan processes multiple orders for the same account. Always release
      // those sessions when the scheduled run ends, including on scan errors.
      await Promise.allSettled([...dependencyByWorkspace.values()].map(async (deps) => {
        if (typeof deps?.finalizeExecutionBatch === 'function') await deps.finalizeExecutionBatch();
      }));
    }
  };
}
