import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionPendingOrderLifecycleRuntime } from '../src/execution/pending_order_lifecycle_production.js';

const row = { workspaceId: 'workspace-1', groupId: 'group-1', tradeAccountId: 'row-1', legId: 'leg-1', brokerOrderId: 'order-1', symbol: 'EURUSD' };
const account = { id: 'row-1', workspace_id: 'workspace-1', account_id: 'demo-123', environment: 'demo' };
const snapshot = { status: 'PARTIALLY_FILLED', accountId: 'demo-123', brokerOrderId: 'order-1', environment: 'demo', isLive: false, requestedLots: 0.1, remainingLots: 0.06, fills: [{ positionId: 'position-1', lots: 0.04, fillPrice: 1.08 }], observedAt: 1000 };

test('production lifecycle runtime is dormant without the exact feature flag', async () => {
  let openedPersistence = false;
  const run = createProductionPendingOrderLifecycleRuntime({
    persistenceFactory: async () => { openedPersistence = true; throw new Error('must not open DB while disabled'); },
  });
  assert.deepEqual(await run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'True' }), { status: 'disabled', scanned: 0, applied: 0 });
  assert.equal(openedPersistence, false);
});

test('production lifecycle runtime applies broker-confirmed DEMO snapshots from the marked-order query', async () => {
  const applied = [];
  let finalized = 0;
  const run = createProductionPendingOrderLifecycleRuntime({
    persistenceFactory: async () => ({ supabase: {}, async listPendingOrderLifecycles() { return [row]; } }),
    dependenciesFactory: () => ({
      async accountLoader(workspaceId, id) { assert.equal(workspaceId, row.workspaceId); assert.equal(id, row.tradeAccountId); return account; },
      async readPendingOrderLifecycleStatus(input) { assert.equal(input.brokerOrderId, row.brokerOrderId); return snapshot; },
      async finalizeExecutionBatch() { finalized++; },
    }),
    applySnapshot: async (_env, input) => { applied.push(input); return { outcome: 'APPLIED' }; },
    clock: () => 1234,
  });
  const result = await run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true' });
  assert.deepEqual(result, { status: 'ok', scanned: 1, applied: 1, skipped: 0 });
  assert.equal(applied[0].workspaceId, row.workspaceId);
  assert.equal(applied[0].groupId, row.groupId);
  assert.equal(applied[0].legId, row.legId);
  assert.equal(applied[0].snapshot.status, 'PARTIALLY_FILLED');
  assert.equal(finalized, 1);
});

test('production lifecycle runtime passes the separate LIVE gate and applies only an exact LIVE broker result', async () => {
  const liveAccount = { ...account, account_id: 'live-123', environment: 'live', platform: 'mt5', provider_mode: 'mt5_connector' };
  const liveSnapshot = { status: 'FILLED', accountId: 'live-123', brokerOrderId: 'order-1', environment: 'live', isLive: true,
    requestedLots: 0.1, remainingLots: 0, fills: [{ positionId: 'position-live-1', lots: 0.1 }], observedAt: 1000 };
  const applied = [];
  const run = createProductionPendingOrderLifecycleRuntime({
    persistenceFactory: async () => ({ supabase: {}, async listPendingOrderLifecycles() { return [row]; } }),
    dependenciesFactory: () => ({
      async accountLoader() { return liveAccount; },
      async readPendingOrderLifecycleStatus() { return liveSnapshot; },
      async finalizeExecutionBatch() {},
    }),
    applySnapshot: async (_env, input) => { applied.push(input); return { outcome: 'APPLIED' }; },
  });

  const disabled = await run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true' });
  assert.equal(disabled.applied, 0);
  assert.equal(applied.length, 0);

  const enabled = await run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true', PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED: 'true' });
  assert.equal(enabled.applied, 1);
  assert.equal(applied[0].snapshot.isLive, true);
});
