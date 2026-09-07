import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionDestinationRetryRuntime } from '../src/execution/destination_retry_production.js';

function claimedRetry() {
  return {
    id: 'delivery-setup-failure',
    workspace_id: 'ws-1',
    trading_event_id: 'evt-1',
    destination_type: 'mt5',
    destination_ref: 'trade-account:acc-1',
    idempotency_key: 'group:g1:leg:l1:open',
    status: 'PENDING',
    attempt_count: 2,
    request_payload: {
      destinationType: 'mt5',
      accountId: 'acc-1',
      groupId: 'g1',
      action: {
        type: 'OPEN_POSITION',
        idempotencyKey: 'group:g1:leg:l1:open',
      },
    },
  };
}

test('retry setup failure is durably rescheduled with the configured delay', async () => {
  const delivery = claimedRetry();
  let retryTransition = null;
  const baseStore = {
    async claimRetry() { return { claimed: true, row: delivery }; },
    async reserve() { throw new Error('reserve must not run when dependency setup fails'); },
    async complete() {},
    async fail() {},
    async markUncertain() {},
    async markRetryable(key, failure, options) {
      assert.equal(key, delivery.idempotency_key);
      assert.equal(failure.code, 'RETRY_SETUP_FAILED');
      assert.equal(failure.message, 'dependency construction failed');
      assert.equal(options?.nextAttemptAt, '2026-09-03T10:01:15.000Z');
      retryTransition = { key, failure, options };
    },
  };

  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => [{ ...delivery, status: 'RETRYABLE', next_attempt_at: '2026-09-03T10:00:00.000Z' }],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async () => { throw new Error('dependency construction failed'); },
    retryDelayMs: 15000,
  });

  const result = await runtime(
    { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    { nowMs: Date.parse('2026-09-03T10:01:00.000Z') },
  );

  assert.equal(result.status, 'FAILED');
  assert.equal(result.claimed, 1);
  assert.equal(result.failed, 1);
  assert.ok(retryTransition);
});
