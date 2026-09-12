import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionDestinationRetryRuntime } from '../src/execution/destination_retry_production.js';

const brokerOn = async () => ({ ok: true, enabled: true });

function retryRow(overrides = {}) {
  return {
    id: 'delivery-1',
    workspace_id: 'ws-1',
    trading_event_id: 'evt-db-1',
    destination_type: 'mt5',
    destination_ref: 'trade-account:acc-1',
    idempotency_key: 'group:g1:leg:l1:open',
    status: 'RETRYABLE',
    attempt_count: 1,
    next_attempt_at: '2026-09-03T10:00:00.000Z',
    request_payload: {
      destinationType: 'mt5',
      accountId: 'acc-1',
      groupId: 'g1',
      action: { type: 'OPEN_POSITION', legId: 'l1', idempotencyKey: 'group:g1:leg:l1:open' },
    },
    ...overrides,
  };
}

test('production retry claims through existing persistent store and dispatches only the exact trusted account/group/action', async () => {
  const row = retryRow();
  const calls = [];
  const baseStore = {
    async claimRetry(key, options) {
      calls.push(['claim', key, options]);
      return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } };
    },
    async reserve() { throw new Error('base reserve must never be used for a claimed retry'); },
    async complete(key) { calls.push(['complete', key]); },
    async fail(key, meta) { calls.push(['fail', key, meta]); },
    async markRetryable(key) { calls.push(['retryable', key]); },
    async markUncertain(key) { calls.push(['uncertain', key]); },
  };

  let claimedStoreFactory;
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    brokerExecutionControlResolver: brokerOn,
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async (context, overrides) => {
      assert.equal(context.workspaceId, 'ws-1');
      assert.equal(context.tradingEventId, 'evt-db-1');
      claimedStoreFactory = overrides.deliveryStoreFactory;
      return { accountLoader: async () => null, authorityLoader: async () => null, dispatchAction: async () => null, stateBinder: async () => null };
    },
    executeProductionFn: async ({ workspaceId, accountPlans, brokerExecutionEnabled }, deps) => {
      assert.equal(workspaceId, 'ws-1');
      assert.equal(brokerExecutionEnabled, true);
      assert.deepEqual(accountPlans, [{
        accountId: 'acc-1',
        groupId: 'g1',
        actions: [row.request_payload.action],
      }]);

      const claimedStore = claimedStoreFactory(null, {
        workspaceId: 'ws-1',
        destinationType: 'mt5',
        destinationRef: 'trade-account:acc-1',
        tradingEventId: 'evt-db-1',
      });
      const reservation = await claimedStore.reserve(row.idempotency_key, { action: row.request_payload.action });
      assert.equal(reservation.ok, true);
      await assert.rejects(() => claimedStore.reserve(row.idempotency_key, {}), /already consumed/i);
      assert.ok(deps);
      return { status: 'SUCCEEDED', accounts: [{ accountId: 'acc-1', status: 'SUCCEEDED', actions: [] }] };
    },
  });

  const result = await runtime({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'false' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.succeeded, 1);
  assert.equal(calls[0][0], 'claim');
  assert.equal(calls[0][1], row.idempotency_key);
});

test('trading access disabled prevents due scan, claim, dependency construction, and broker retry', async () => {
  const row = retryRow();
  let supabaseCalls = 0;
  let dueScans = 0;
  let storeCalls = 0;
  let depsCalls = 0;
  let executeCalls = 0;
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => { supabaseCalls += 1; return { from() {} }; },
    brokerExecutionControlResolver: brokerOn,
    listDueFn: async () => { dueScans += 1; return [row]; },
    deliveryStoreFactory: () => { storeCalls += 1; return {}; },
    executionDepsFactory: async () => { depsCalls += 1; return {}; },
    executeProductionFn: async () => { executeCalls += 1; return {}; },
  });

  const result = await runtime({ TRADING_ACCESS_ENABLED: 'false', BROKER_EXECUTION_ENABLED: 'true' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(result.status, 'TRADING_ACCESS_DISABLED');
  assert.equal(supabaseCalls, 0);
  assert.equal(dueScans, 0);
  assert.equal(storeCalls, 0);
  assert.equal(depsCalls, 0);
  assert.equal(executeCalls, 0);
});

test('persisted broker execution switch OFF prevents due scan, claim, dependency construction, and broker retry regardless of env', async () => {
  const row = retryRow();
  let supabaseCalls = 0;
  let dueScans = 0;
  let storeCalls = 0;
  let depsCalls = 0;
  let executeCalls = 0;
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => { supabaseCalls += 1; return { from() {} }; },
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: false }),
    listDueFn: async () => { dueScans += 1; return [row]; },
    deliveryStoreFactory: () => { storeCalls += 1; return {}; },
    executionDepsFactory: async () => { depsCalls += 1; return {}; },
    executeProductionFn: async () => { executeCalls += 1; return {}; },
  });

  const result = await runtime({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(result.status, 'BROKER_OWNER_SWITCH_OFF');
  assert.equal(supabaseCalls, 1);
  assert.equal(dueScans, 0);
  assert.equal(storeCalls, 0);
  assert.equal(depsCalls, 0);
  assert.equal(executeCalls, 0);
});

test('revoked account authority after retry scheduling becomes terminal without broker dispatch', async () => {
  const row = retryRow();
  const calls = [];
  const baseStore = {
    async claimRetry() { return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } }; },
    async reserve() { throw new Error('must not reserve'); },
    async complete() {},
    async markRetryable() {},
    async markUncertain() {},
    async fail(key, metadata) { calls.push(['fail', key, metadata]); },
  };
  let brokerDispatches = 0;

  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    brokerExecutionControlResolver: brokerOn,
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async () => ({
      accountLoader: async () => ({
        id: 'acc-1', workspace_id: 'ws-1', is_active: false, execution_enabled: false,
        safety_policy: { enabled: true, killSwitch: true },
      }),
      dispatchAction: async () => { brokerDispatches += 1; },
      stateBinder: async () => {},
    }),
  });

  const result = await runtime({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'false' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(brokerDispatches, 0);
  assert.equal(result.failed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'fail');
  assert.equal(calls[0][1], row.idempotency_key);
});

test('source revocation is re-resolved from durable retry event authority and blocks broker dispatch', async () => {
  const row = retryRow({
    request_payload: {
      destinationType: 'mt5',
      accountId: 'acc-1',
      groupId: 'g1',
      sourceId: 'attacker-source-hint',
      workspaceId: 'attacker-workspace-hint',
      action: { type: 'OPEN_POSITION', legId: 'l1', idempotencyKey: 'group:g1:leg:l1:open' },
    },
  });
  const calls = [];
  let brokerDispatches = 0;
  const baseStore = {
    async claimRetry() { return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } }; },
    async reserve() { throw new Error('must not reserve when authority is revoked'); },
    async complete() {},
    async markRetryable() {},
    async markUncertain() {},
    async fail(key, metadata) { calls.push(['fail', key, metadata]); },
  };

  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    brokerExecutionControlResolver: brokerOn,
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async (context) => {
      assert.equal(context.workspaceId, 'ws-1');
      assert.equal(context.tradingEventId, 'evt-db-1');
      assert.notEqual(context.workspaceId, row.request_payload.workspaceId);
      return {
        accountLoader: async () => ({
          id: 'acc-1', workspace_id: 'ws-1', is_active: true, execution_enabled: true,
          safety_policy: { enabled: true, killSwitch: false },
        }),
        authorityLoader: async ({ workspaceId, tradingEventId, accountId }) => {
          assert.equal(workspaceId, 'ws-1');
          assert.equal(tradingEventId, 'evt-db-1');
          assert.equal(accountId, 'acc-1');
          const error = new Error('originating source is inactive');
          error.code = 'EXECUTION_AUTHORITY_REVOKED';
          throw error;
        },
        dispatchAction: async () => { brokerDispatches += 1; return { ok: true }; },
        stateBinder: async () => {},
      };
    },
  });

  const result = await runtime({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'false' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(brokerDispatches, 0);
  assert.equal(result.failed, 1);
  assert.equal(calls.some(([method]) => method === 'fail'), true);
});

test('destination/account mismatch fails closed before constructing execution dependencies', async () => {
  const row = retryRow({ destination_ref: 'trade-account:other' });
  let depsCalls = 0;
  const baseStore = {
    async claimRetry() { return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } }; },
    async reserve() {}, async complete() {}, async markRetryable() {}, async markUncertain() {}, async fail() {},
  };
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    brokerExecutionControlResolver: brokerOn,
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async () => { depsCalls += 1; return {}; },
  });

  const result = await runtime({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'false' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(depsCalls, 0);
  assert.equal(result.failed, 1);
});
