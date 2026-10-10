import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1SimulationDependencies } from '../src/pipeline/v1_simulation_deps.js';

const group = {
  id: 'group-1', workspaceId: 'workspace-1', tradeAccountId: 'account-row-1', symbol: 'EURUSD',
  legs: [{ legId: 'leg-1', status: 'PENDING', brokerOrderId: 'order-1', lifecycleTrackingEnabled: true }],
};
const account = {
  id: 'account-row-1', workspace_id: 'workspace-1', account_id: 'demo-123', environment: 'demo',
};
const snapshot = {
  status: 'PARTIALLY_FILLED', accountId: 'demo-123', brokerOrderId: 'order-1',
  environment: 'demo', isLive: false, requestedLots: 0.1, remainingLots: 0.06,
  fills: [{ positionId: 'position-1', lots: 0.04, isOpen: true }], observedAt: 1000,
};

test('flag-off simulation dependencies do not expose a broker lifecycle preflight', async () => {
  let created = 0;
  const deps = await createV1SimulationDependencies({
    env: { TRADE_STATE_INTERNAL_TOKEN: 'internal-token', TRADE_STATE_NAMESPACE: { idFromName: (id) => id, get: () => ({ fetch: async () => Response.json({}) }) } },
    supabase: { from() { throw new Error('not used'); } },
    event: { workspace_hint: 'workspace-1' },
    lifecycleDependenciesFactory() { created++; throw new Error('must remain dormant'); },
  });
  assert.equal(deps.refreshPendingOrderLifecycle, undefined);
  assert.equal(created, 0);
});

test('DEMO preflight leaves unmarked legacy pending trades untouched', async () => {
  let reads = 0;
  const deps = await createV1SimulationDependencies({
    env: {
      PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true',
      TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
      TRADE_STATE_NAMESPACE: { idFromName: (id) => id, get: () => ({ fetch: async () => Response.json(group) }) },
    },
    supabase: { from() { throw new Error('not used'); } },
    event: { workspace_hint: 'workspace-1' },
    lifecycleDependenciesFactory: () => ({
      async readPendingOrderLifecycleStatus() { reads++; return snapshot; },
      async finalizeExecutionBatch() {},
    }),
  });
  const legacy = { ...group, legs: [{ legId: 'leg-1', status: 'PENDING', brokerOrderId: 'order-1' }] };
  assert.deepEqual(await deps.refreshPendingOrderLifecycle({ group: legacy, account }), legacy);
  assert.equal(reads, 0);
});

test('DEMO preflight applies an exact broker snapshot and returns refreshed Trade State', async () => {
  const calls = [];
  let finalized = 0;
  const refreshed = { ...group, legs: [{ legId: 'leg-1:fill:position-1', status: 'OPEN' }] };
  const stub = {
    async fetch(url, init = {}) {
      calls.push({ url, init });
      if (url.endsWith('/pending-order-snapshot')) return Response.json({ outcome: 'APPLIED' });
      if (url.endsWith('/groups/group-1')) return Response.json(refreshed);
      throw new Error(`unexpected state path ${url}`);
    },
  };
  const deps = await createV1SimulationDependencies({
    env: {
      PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true',
      TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
      TRADE_STATE_NAMESPACE: { idFromName: (id) => id, get: () => stub },
    },
    supabase: { from() { throw new Error('not used'); } },
    event: { workspace_hint: 'workspace-1' },
    lifecycleDependenciesFactory({ workspaceId }) {
      assert.equal(workspaceId, 'workspace-1');
      return {
        async readPendingOrderLifecycleStatus(input) {
          assert.equal(input.account, account);
          assert.equal(input.brokerOrderId, 'order-1');
          assert.equal(input.symbol, 'EURUSD');
          return snapshot;
        },
        async finalizeExecutionBatch() { finalized++; },
      };
    },
  });

  const result = await deps.refreshPendingOrderLifecycle({ group, account });
  assert.deepEqual(result, refreshed);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-mkety-workspace-id'], 'workspace-1');
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.tradeAccountId, 'account-row-1');
  assert.equal(payload.brokerOrderId, 'order-1');
  assert.equal(payload.snapshot.isLive, false);
  assert.equal(finalized, 1);
});

test('LIVE Close preflight requires its separate opt-in and accepts only exact LIVE snapshots', async () => {
  const liveAccount = { ...account, account_id: 'live-123', environment: 'live', platform: 'mt5' };
  const liveSnapshot = { ...snapshot, accountId: 'live-123', environment: 'live', isLive: true };
  const env = {
    PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true',
    PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED: 'true',
    TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
    TRADE_STATE_NAMESPACE: { idFromName: (id) => id, get: () => ({ fetch: async (_url, init = {}) =>
      Response.json(init.method === 'GET' ? group : { outcome: 'APPLIED' }) }) },
  };
  let reads = 0;
  const deps = await createV1SimulationDependencies({
    env,
    supabase: { from() { throw new Error('not used'); } },
    event: { workspace_hint: 'workspace-1' },
    lifecycleDependenciesFactory: () => ({
      async readPendingOrderLifecycleStatus() { reads++; return liveSnapshot; },
      async finalizeExecutionBatch() {},
    }),
  });
  const result = await deps.refreshPendingOrderLifecycle({ group, account: liveAccount });
  assert.equal(reads, 1);
  assert.equal(result.legs[0].status, 'PENDING');

  const disabled = await createV1SimulationDependencies({
    env: { ...env, PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED: 'false' },
    supabase: { from() { throw new Error('not used'); } },
    event: { workspace_hint: 'workspace-1' },
    lifecycleDependenciesFactory: () => ({
      async readPendingOrderLifecycleStatus() { reads++; return liveSnapshot; },
      async finalizeExecutionBatch() {},
    }),
  });
  await assert.rejects(() => disabled.refreshPendingOrderLifecycle({ group, account: liveAccount }), /LIVE pending lifecycle sync is disabled/i);
  assert.equal(reads, 1);
});

test('DEMO preflight ignores a broker identity mismatch without writing state', async () => {
  let writes = 0;
  let finalized = 0;
  const stub = {
    async fetch(url, init = {}) {
      if (url.endsWith('/pending-order-snapshot')) writes++;
      if (init.method === 'GET') return Response.json(group);
      return Response.json({ outcome: 'UNCHANGED' });
    },
  };
  const deps = await createV1SimulationDependencies({
    env: {
      PENDING_ORDER_LIFECYCLE_SYNC_ENABLED: 'true',
      TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
      TRADE_STATE_NAMESPACE: { idFromName: (id) => id, get: () => stub },
    },
    supabase: { from() { throw new Error('not used'); } },
    event: { workspace_hint: 'workspace-1' },
    lifecycleDependenciesFactory: () => ({
      async readPendingOrderLifecycleStatus() { return { ...snapshot, brokerOrderId: 'other-order' }; },
      async finalizeExecutionBatch() { finalized++; },
    }),
  });
  await assert.rejects(() => deps.refreshPendingOrderLifecycle({ group, account }), /unresolved or mismatched/i);
  assert.equal(writes, 0);
  assert.equal(finalized, 1);
});
