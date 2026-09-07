import test from 'node:test';
import assert from 'node:assert/strict';
import { createDestinationRetryRuntime } from '../src/execution/destination_retry_runtime.js';

function row(overrides = {}) {
  const idempotencyKey = overrides.idempotency_key ?? 'group:g1:leg:l1:open';
  const requestPayload = overrides.request_payload === undefined ? {
    destinationType: 'mt5', accountId: 'acc-1', groupId: 'g1',
    action: { type: 'OPEN_POSITION', legId: 'l1', idempotencyKey },
  } : overrides.request_payload;
  return {
    id: 'd-1', workspace_id: 'ws-1', destination_type: 'mt5', destination_ref: 'trade-account:acc-1',
    idempotency_key: idempotencyKey, status: 'RETRYABLE', attempt_count: 1,
    next_attempt_at: '2026-09-03T10:00:00.000Z', request_payload: requestPayload,
    ...overrides,
    idempotency_key: idempotencyKey,
    request_payload: requestPayload,
  };
}

test('broker master fuse false returns before Supabase construction or scanning', async () => {
  const calls = [];
  const runtime = createDestinationRetryRuntime({
    supabaseFactory: async () => { calls.push('supabase'); throw new Error('must not construct'); },
    listDueFn: async () => { calls.push('scan'); throw new Error('must not scan'); },
    claimFn: async () => { calls.push('claim'); throw new Error('must not claim'); },
    recoverFn: async () => { calls.push('recover'); throw new Error('must not recover'); },
  });

  const result = await runtime({ BROKER_EXECUTION_ENABLED: 'false' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.deepEqual(result, {
    status: 'BROKER_EXECUTION_DISABLED', scanned: 0, claimed: 0, dispatched: 0, succeeded: 0, failed: 0,
  });
  assert.deepEqual(calls, []);
});

test('runtime scans a bounded due batch and recovers only atomically claimed rows', async () => {
  const due = [row(), row({ id: 'd-2', idempotency_key: 'k2' }), row({ id: 'd-3', idempotency_key: 'k3' })];
  const claimed = [];
  const recovered = [];
  const runtime = createDestinationRetryRuntime({
    supabaseFactory: async () => ({ kind: 'db' }),
    listDueFn: async ({ now, limit }) => {
      assert.equal(now, '2026-09-03T10:01:00.000Z');
      assert.equal(limit, 2);
      return due.slice(0, limit);
    },
    claimFn: async ({ delivery, now, leaseUntil }) => {
      claimed.push(delivery.id);
      assert.equal(now, '2026-09-03T10:01:00.000Z');
      assert.equal(leaseUntil, '2026-09-03T10:01:30.000Z');
      return delivery.id === 'd-1' ? { claimed: true, row: { ...delivery, status: 'PENDING', attempt_count: 2 } } : { claimed: false };
    },
    recoverFn: async ({ delivery }) => { recovered.push(delivery.id); return { status: 'SUCCEEDED' }; },
    batchLimit: 2,
    leaseMs: 30000,
  });

  const result = await runtime({ BROKER_EXECUTION_ENABLED: 'true' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.scanned, 2);
  assert.equal(result.claimed, 1);
  assert.equal(result.dispatched, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(claimed, ['d-1', 'd-2']);
  assert.deepEqual(recovered, ['d-1']);
});

test('one recovery failure is isolated and does not block claimed siblings', async () => {
  const due = [row({ id: 'd-1' }), row({ id: 'd-2', idempotency_key: 'k2' })];
  const recovered = [];
  const runtime = createDestinationRetryRuntime({
    supabaseFactory: async () => ({}),
    listDueFn: async () => due,
    claimFn: async ({ delivery }) => ({ claimed: true, row: { ...delivery, status: 'PENDING' } }),
    recoverFn: async ({ delivery }) => {
      recovered.push(delivery.id);
      if (delivery.id === 'd-1') throw new Error('transient sibling failure');
      return { status: 'SUCCEEDED' };
    },
  });

  const result = await runtime({ BROKER_EXECUTION_ENABLED: 'true' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.deepEqual(recovered, ['d-1', 'd-2']);
  assert.equal(result.claimed, 2);
  assert.equal(result.dispatched, 2);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.status, 'PARTIAL_FAILURE');
});

test('runtime rejects malformed due rows before atomic claim so they cannot be stranded PENDING', async () => {
  let claimCalls = 0;
  let recoveryCalls = 0;
  const malformed = row({ request_payload: null });
  const runtime = createDestinationRetryRuntime({
    supabaseFactory: async () => ({}),
    listDueFn: async () => [malformed],
    claimFn: async ({ delivery }) => {
      claimCalls += 1;
      return { claimed: true, row: { ...delivery, status: 'PENDING' } };
    },
    recoverFn: async () => { recoveryCalls += 1; },
  });

  const result = await runtime({ BROKER_EXECUTION_ENABLED: 'true' }, { nowMs: Date.parse('2026-09-03T10:01:00Z') });
  assert.equal(claimCalls, 0);
  assert.equal(recoveryCalls, 0);
  assert.equal(result.scanned, 1);
  assert.equal(result.claimed, 0);
  assert.equal(result.dispatched, 0);
  assert.equal(result.failed, 1);
});
