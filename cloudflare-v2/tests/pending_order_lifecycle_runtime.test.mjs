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

test('LIVE pending lifecycle requires its own exact opt-in and only applies a matching LIVE observation', async () => {
  const liveAccount = { workspace_id: 'ws-1', account_id: 'acct-1', environment: 'live', platform: 'mt5', provider_mode: 'mt5_connector' };
  const liveSnapshot = { status: 'PARTIALLY_FILLED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'live', isLive: true, remainingLots: 0.06, fills: [{ positionId: 'position-1', lots: 0.04 }], observedAt: 10 };
  const disabled = runtimeHarness({ account: liveAccount, snapshot: liveSnapshot });
  const disabledResult = await disabled.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true' });
  assert.equal(disabledResult.applied, 0);
  assert.equal(disabled.calls.some(([kind]) => kind === 'read'), false);

  const nonExactOptIn = runtimeHarness({ account: liveAccount, snapshot: liveSnapshot });
  const nonExactResult = await nonExactOptIn.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true', PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED: 'TRUE' });
  assert.equal(nonExactResult.applied, 0);
  assert.equal(nonExactOptIn.calls.some(([kind]) => kind === 'read'), false);

  const h = runtimeHarness({ account: liveAccount, snapshot: liveSnapshot });
  const result = await h.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true', PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED: 'true' });
  assert.equal(result.applied, 1);
  assert.equal(h.applied[0].snapshot.isLive, true);
  assert.equal(h.applied[0].snapshot.environment, 'live');
});

test('LIVE lifecycle skips broker observations that claim DEMO or another account', async () => {
  const account = { workspace_id: 'ws-1', account_id: 'acct-1', environment: 'live', platform: 'ctrader', provider_mode: 'ctrader_oauth' };
  for (const snapshot of [
    { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'live', isLive: false },
    { status: 'FILLED', accountId: 'other', brokerOrderId: 'order-1', environment: 'live', isLive: true },
    { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'wrong', environment: 'live', isLive: true },
    { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'demo', isLive: true },
  ]) {
    const h = runtimeHarness({ account, snapshot });
    const result = await h.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true', PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED: 'true' });
    assert.equal(result.applied, 0);
    assert.equal(h.applied.length, 0);
  }
});

test('LIVE cBot lifecycle can apply a terminal snapshot but skips an unresolved active partial order', async () => {
  const account = { workspace_id: 'ws-1', account_id: 'acct-1', environment: 'live', platform: 'ctrader', provider_mode: 'ctrader_cbot' };
  const enabled = { PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true', PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED: 'true' };
  const terminal = runtimeHarness({ account, snapshot: { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'live', isLive: true, remainingLots: 0, fills: [{ positionId: 'position-1', lots: 0.1 }], observedAt: 10 } });
  assert.equal((await terminal.run(enabled)).applied, 1);
  assert.equal(terminal.calls.some(([kind]) => kind === 'read'), true);

  const uncertain = runtimeHarness({ account, snapshot: { status: 'UNRESOLVED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'live', isLive: true } });
  assert.equal((await uncertain.run(enabled)).applied, 0);
  assert.equal(uncertain.applied.length, 0);
});

test('pending lifecycle leaves cTrader cBot accounts unchanged until active partial fills are observable', async () => {
  const h = runtimeHarness({
    account: { workspace_id: 'ws-1', account_id: 'acct-1', environment: 'demo', platform: 'ctrader', provider_mode: 'ctrader_cbot' },
    snapshot: { status: 'FILLED', accountId: 'acct-1', brokerOrderId: 'order-1', environment: 'demo', isLive: false, remainingLots: 0, fills: [], observedAt: 10 },
  });
  const result = await h.run({ PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true' });
  assert.equal(result.applied, 0);
  assert.equal(h.applied.length, 0);
  assert.equal(h.calls.some(([kind]) => kind === 'read'), false);
});
