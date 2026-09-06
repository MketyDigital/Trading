import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionDestinationRetryRuntime } from '../src/execution/destination_retry_production.js';

function retryRow() {
  return {
    id: 'delivery-1',
    workspace_id: 'ws-1',
    trading_event_id: 'evt-1',
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
  };
}

function harness({ coordinatorResult, durableStatus = 'PENDING' } = {}) {
  const row = retryRow();
  const transitions = [];
  let status = durableStatus;
  const baseStore = {
    async claimRetry() {
      status = 'PENDING';
      return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } };
    },
    async find() { return { ...row, status }; },
    async reserve() { throw new Error('base reserve must not be called for claimed retry'); },
    async complete(key) { status = 'SUCCEEDED'; transitions.push(['complete', key]); },
    async fail(key, failure) { status = 'FAILED'; transitions.push(['fail', key, failure]); },
    async markUncertain(key, failure) { status = 'UNCERTAIN'; transitions.push(['uncertain', key, failure]); },
    async markRetryable(key, failure, options) {
      status = 'RETRYABLE';
      transitions.push(['retryable', key, failure, options]);
    },
  };

  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async () => ({
      accountLoader: async () => null,
      authorityLoader: async () => null,
      dispatchAction: async () => null,
      stateBinder: async () => null,
    }),
    executeProductionFn: async () => coordinatorResult,
    retryDelayMs: 15000,
  });
  return { runtime, transitions, baseStore, setStatus(value) { status = value; } };
}

test('coordinator failure that leaves claimed delivery PENDING is durably rescheduled', async () => {
  const { runtime, transitions } = harness({
    coordinatorResult: {
      status: 'FAILED',
      accounts: [{ accountId: 'acc-1', status: 'FAILED', reason: 'EXECUTION_AUTHORITY_LOAD_FAILED', actions: [] }],
    },
  });

  const result = await runtime(
    { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    { nowMs: Date.parse('2026-09-03T10:01:00.000Z') },
  );

  assert.equal(result.failed, 1);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0][0], 'retryable');
  assert.equal(transitions[0][2].code, 'RETRY_EXECUTION_FAILED_BEFORE_DURABLE_OUTCOME');
  assert.equal(transitions[0][3].nextAttemptAt, '2026-09-03T10:01:15.000Z');
});

test('adapter-owned RETRYABLE or UNCERTAIN durable outcome is never overwritten by wrapper reconciliation', async () => {
  for (const durableStatus of ['RETRYABLE', 'UNCERTAIN', 'FAILED']) {
    const fixture = harness({
      coordinatorResult: {
        status: 'FAILED',
        accounts: [{ accountId: 'acc-1', status: 'FAILED', reason: 'ACCOUNT_ACTION_FAILED', actions: [] }],
      },
    });
    fixture.setStatus(durableStatus);

    // Simulate the adapter transition occurring during coordinator execution.
    const originalFind = fixture.baseStore.find;
    let finds = 0;
    fixture.baseStore.find = async (...args) => {
      finds += 1;
      if (finds === 1) return { ...retryRow(), status: durableStatus };
      return originalFind(...args);
    };

    await fixture.runtime(
      { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
      { nowMs: Date.parse('2026-09-03T10:01:00.000Z') },
    );
    assert.equal(fixture.transitions.length, 0, `wrapper must preserve ${durableStatus}`);
  }
});

test('broker-success row remains SUCCEEDED when only post-broker state binding failed', async () => {
  const row = retryRow();
  const transitions = [];
  const baseStore = {
    async claimRetry() { return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } }; },
    async find() { return { ...row, status: 'SUCCEEDED', response_payload: { brokerPositionId: 'p1' } }; },
    async reserve() {},
    async complete() {},
    async fail(...args) { transitions.push(['fail', ...args]); },
    async markRetryable(...args) { transitions.push(['retryable', ...args]); },
    async markUncertain(...args) { transitions.push(['uncertain', ...args]); },
  };
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async () => ({}),
    executeProductionFn: async () => ({
      status: 'FAILED',
      accounts: [{ accountId: 'acc-1', status: 'FAILED', reason: 'ACCOUNT_ACTION_FAILED', actions: [{ status: 'FAILED', reason: 'STATE_BIND_FAILED' }] }],
    }),
  });

  const result = await runtime(
    { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    { nowMs: Date.parse('2026-09-03T10:01:00.000Z') },
  );

  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(transitions, []);
});
