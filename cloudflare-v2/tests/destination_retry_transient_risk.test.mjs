import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionDestinationRetryRuntime } from '../src/execution/destination_retry_production.js';

const row = {
  id: 'delivery-risk',
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

test('temporary authoritative risk-context outage reschedules claimed retry instead of terminally failing it', async () => {
  const transitions = [];
  const baseStore = {
    async claimRetry() { return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } }; },
    async find() { return { ...row, status: 'PENDING', attempt_count: 2 }; },
    async reserve() {}, async complete() {}, async markUncertain() {},
    async fail(...args) { transitions.push(['fail', ...args]); },
    async markRetryable(key, failure, options) { transitions.push(['retryable', key, failure, options]); },
  };

  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async () => ({}),
    executeProductionFn: async () => ({
      status: 'BLOCKED',
      accounts: [{
        accountId: 'acc-1',
        status: 'BLOCKED',
        reason: 'ACCOUNT_POLICY_BLOCKED',
        blockReason: 'BROKER_RISK_CONTEXT_UNAVAILABLE',
        actions: [],
      }],
    }),
    retryDelayMs: 15000,
  });

  const result = await runtime(
    { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    { nowMs: Date.parse('2026-09-03T10:01:00.000Z') },
  );

  assert.equal(result.failed, 1);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0][0], 'retryable');
  assert.equal(transitions[0][2].code, 'RETRY_RISK_CONTEXT_UNAVAILABLE');
  assert.equal(transitions[0][3].nextAttemptAt, '2026-09-03T10:01:15.000Z');
});

test('true account or authority revocation remains terminal', async () => {
  const transitions = [];
  const baseStore = {
    async claimRetry() { return { claimed: true, row: { ...row, status: 'PENDING', attempt_count: 2 } }; },
    async reserve() {}, async complete() {}, async markRetryable() {}, async markUncertain() {},
    async fail(key, failure) { transitions.push(['fail', key, failure]); },
  };
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => [row],
    deliveryStoreFactory: () => baseStore,
    executionDepsFactory: async () => ({}),
    executeProductionFn: async () => ({
      status: 'BLOCKED',
      accounts: [{ accountId: 'acc-1', status: 'BLOCKED', reason: 'ACCOUNT_INACTIVE', actions: [] }],
    }),
  });

  await runtime(
    { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    { nowMs: Date.parse('2026-09-03T10:01:00.000Z') },
  );
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0][0], 'fail');
  assert.equal(transitions[0][2].code, 'RETRY_EXECUTION_AUTHORITY_REVOKED');
});
