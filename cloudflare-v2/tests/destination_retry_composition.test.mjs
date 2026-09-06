import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listDueDestinationRetries,
  createClaimedDeliveryStore,
  createContextualDeliveryStore,
} from '../src/execution/destination_retry_composition.js';

function queryRecorder(rowsByStatus = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'destination_deliveries');
      let status = null;
      const chain = {
        select(columns) { calls.push(['select', columns]); return chain; },
        eq(column, value) { calls.push(['eq', column, value]); if (column === 'status') status = value; return chain; },
        lte(column, value) { calls.push(['lte', column, value]); return chain; },
        lt(column, value) { calls.push(['lt', column, value]); return chain; },
        or(value) { calls.push(['or', value]); return chain; },
        order(column, options) { calls.push(['order', column, options]); return chain; },
        limit(value) {
          calls.push(['limit', value]);
          return Promise.resolve({ data: rowsByStatus[status] || [], error: null });
        },
      };
      return chain;
    },
  };
  return { supabase, calls };
}

test('due retry scan includes due RETRYABLE work and expired leased PENDING crash recovery, then bounds the merged batch', async () => {
  const retryable = [{ id: 'r1', status: 'RETRYABLE', next_attempt_at: '2026-09-03T09:59:00.000Z' }];
  const expiredPending = [{ id: 'p1', status: 'PENDING', lease_expires_at: '2026-09-03T09:58:00.000Z' }];
  const { supabase, calls } = queryRecorder({ RETRYABLE: retryable, PENDING: expiredPending });
  const result = await listDueDestinationRetries({
    supabase,
    now: '2026-09-03T10:00:00.000Z',
    limit: 20,
    maxAttempts: 5,
  });

  assert.deepEqual(result.map((item) => item.id), ['p1', 'r1']);
  assert.deepEqual(calls, [
    ['select', '*'],
    ['eq', 'status', 'RETRYABLE'],
    ['lte', 'next_attempt_at', '2026-09-03T10:00:00.000Z'],
    ['lt', 'attempt_count', 5],
    ['or', 'lease_expires_at.is.null,lease_expires_at.lt.2026-09-03T10:00:00.000Z'],
    ['order', 'next_attempt_at', { ascending: true }],
    ['limit', 20],
    ['select', '*'],
    ['eq', 'status', 'PENDING'],
    ['lt', 'lease_expires_at', '2026-09-03T10:00:00.000Z'],
    ['order', 'lease_expires_at', { ascending: true }],
    ['limit', 20],
  ]);
});

test('merged retry scan is globally bounded and orders expired leases with normal due work', async () => {
  const { supabase } = queryRecorder({
    RETRYABLE: [
      { id: 'r-late', status: 'RETRYABLE', next_attempt_at: '2026-09-03T09:59:30.000Z' },
      { id: 'r-early', status: 'RETRYABLE', next_attempt_at: '2026-09-03T09:57:00.000Z' },
    ],
    PENDING: [
      { id: 'p-mid', status: 'PENDING', lease_expires_at: '2026-09-03T09:58:00.000Z' },
    ],
  });

  const result = await listDueDestinationRetries({
    supabase,
    now: '2026-09-03T10:00:00.000Z',
    limit: 2,
    maxAttempts: 5,
  });
  assert.deepEqual(result.map((item) => item.id), ['r-early', 'p-mid']);
});

test('contextual store persists trusted account/group context around broker action reservation', async () => {
  const calls = [];
  const base = {
    reserve: async (key, payload) => { calls.push(['reserve', key, payload]); return { ok: true, duplicate: false }; },
    complete: async (...args) => calls.push(['complete', ...args]),
    fail: async (...args) => calls.push(['fail', ...args]),
    markRetryable: async (...args) => calls.push(['retryable', ...args]),
    markUncertain: async (...args) => calls.push(['uncertain', ...args]),
  };
  const store = createContextualDeliveryStore(base, { accountId: 'acc-1', groupId: 'g-1', destinationType: 'mt5' });
  const action = { type: 'OPEN_POSITION', legId: 'l1', idempotencyKey: 'k1' };
  await store.reserve('k1', { destinationType: 'mt5', action });
  assert.deepEqual(calls[0], ['reserve', 'k1', {
    destinationType: 'mt5', accountId: 'acc-1', groupId: 'g-1', action,
  }]);
});

test('claimed delivery store authorizes exactly one reserve of the exact durable key and delegates terminal updates', async () => {
  const calls = [];
  const base = {
    reserve: async () => { throw new Error('base reserve must not run for claimed retry'); },
    complete: async (...args) => calls.push(['complete', ...args]),
    fail: async (...args) => calls.push(['fail', ...args]),
    markRetryable: async (...args) => calls.push(['retryable', ...args]),
    markUncertain: async (...args) => calls.push(['uncertain', ...args]),
  };
  const claimed = { id: 'd1', idempotency_key: 'k1', status: 'PENDING', attempt_count: 2 };
  const store = createClaimedDeliveryStore(base, claimed);

  assert.deepEqual(await store.reserve('k1', { ignored: true }), { ok: true, duplicate: false, row: claimed });
  await assert.rejects(() => store.reserve('other-key'), /claimed retry key mismatch/);
  await assert.rejects(() => store.reserve('k1'), /claimed retry reservation already consumed/);
  await store.complete('k1', { brokerPositionId: 'p1' });
  assert.deepEqual(calls, [['complete', 'k1', { brokerPositionId: 'p1' }]]);
});

test('claimed delivery store refuses terminal mutation for any key other than the claimed delivery', async () => {
  const base = {
    complete: async () => {}, fail: async () => {}, markRetryable: async () => {}, markUncertain: async () => {},
  };
  const store = createClaimedDeliveryStore(base, { idempotency_key: 'k1' });
  await assert.rejects(() => store.complete('k2', {}), /claimed retry key mismatch/);
  await assert.rejects(() => store.fail('k2', {}), /claimed retry key mismatch/);
  await assert.rejects(() => store.markRetryable('k2', {}, {}), /claimed retry key mismatch/);
  await assert.rejects(() => store.markUncertain('k2', {}), /claimed retry key mismatch/);
});
