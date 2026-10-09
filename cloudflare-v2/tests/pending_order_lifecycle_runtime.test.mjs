import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingOrderLifecycleRuntime } from '../src/execution/pending_order_lifecycle_runtime.js';

function runtimeHarness({ account = { workspace_id: 'ws-1', account_id: 'acct-1', environment: 'demo' }, snapshot } = {}) {
  const applied = [];
  const calls = [];
  const run = createPendingOrderLifecycleRuntime({
    loadCandidates: async () => [{ workspaceId: 'ws-1', groupId: 'group-1', tradeAccountId: 'row-1', legId: 'leg-1', brokerOrderId: 'order-1', symbol: 'EURUSD' }],
    loadAccount: async (workspaceId, id) => { calls.push(['account', workspaceId, id]); return account; },
    readStatus: async (input) => { calls.push(['read', input.lifecycle.brokerOrderId]); return snapshot; },
    applySnapshot: async (input) => { applied.push(input); return { outcome: 'APPLIED' }; },
    clock: () => 1234,
  });
  return { run, applied, calls };
}

test('pending lifecycle runtime is exactly opt-in and makes no broker calls while disabled', async () => {
  const h = runtimeHarness({ snapshot: { status: 'FILLED' } });
  assert.deepEqual(await h.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'TRUE' }), { status: 'disabled', scanned: 0, applied: 0 });
  assert.deepEqual(h.calls, []);
});

test('pending lifecycle applies only a broker-confirmed demo snapshot for exact account and order', async () => {
  const h = runtimeHarness({ snapshot: { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'demo', isLive: false, remainingLots: 0, fills: [], observedAt: 10 } });
  const result = await h.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true' });
  assert.equal(result.applied, 1);
  assert.equal(h.applied[0].snapshot.observedAt, 10);
});

test('pending lifecycle skips LIVE, mismatched, and unresolved broker observations', async () => {
  for (const snapshot of [
    { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'demo', isLive: true },
    { status: 'FILLED', accountId: 'other', brokerOrderId: 'order-1', environment: 'demo', isLive: false },
    { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'wrong', environment: 'demo', isLive: false },
    { status: 'UNRESOLVED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'demo', isLive: false },
  ]) {
    const h = runtimeHarness({ snapshot });
    const result = await h.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true' });
    assert.equal(result.applied, 0);
    assert.equal(h.applied.length, 0);
  }
});

test('pending lifecycle never reads a production account', async () => {
  const h = runtimeHarness({ account: { workspace_id: 'ws-1', account_id: 'acct-1', environment: 'live' }, snapshot: { status: 'FILLED' } });
  const result = await h.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true' });
  assert.equal(result.applied, 0);
  assert.equal(h.calls.some(([kind]) => kind === 'read'), false);
});
