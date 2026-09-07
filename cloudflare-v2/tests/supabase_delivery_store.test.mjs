import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseDeliveryStore } from '../src/persistence/supabase_delivery_store.js';

class FakeSupabase {
  constructor() { this.rows = new Map(); }

  keyOf(row) { return `${row.workspace_id}:${row.idempotency_key}`; }

  from(name) {
    assert.equal(name, 'destination_deliveries');
    const db = this;

    function matching(filters) {
      return [...db.rows.values()].filter((row) => filters.every(({ column, op, value }) => {
        const actual = row[column];
        if (op === 'eq') return String(actual) === String(value);
        if (op === 'lte') return actual != null && new Date(actual).getTime() <= new Date(value).getTime();
        if (op === 'is') return value === null ? actual == null : actual === value;
        throw new Error(`unsupported filter ${op}`);
      }));
    }

    return {
      insert(values) {
        return {
          async select() {
            const row = Array.isArray(values) ? values[0] : values;
            const key = db.keyOf(row);
            if (db.rows.has(key)) return { data: null, error: { code: '23505', message: 'duplicate' } };
            const saved = { id: `id-${db.rows.size + 1}`, ...row };
            db.rows.set(key, saved);
            return { data: [saved], error: null };
          },
        };
      },
      select() {
        const filters = [];
        const chain = {
          eq(column, value) { filters.push({ column, op: 'eq', value }); return chain; },
          lte(column, value) { filters.push({ column, op: 'lte', value }); return chain; },
          is(column, value) { filters.push({ column, op: 'is', value }); return chain; },
          limit() { return chain; },
          order() { return chain; },
          async maybeSingle() { return { data: matching(filters)[0] || null, error: null }; },
          then(resolve) { resolve({ data: matching(filters), error: null }); },
        };
        return chain;
      },
      update(patch) {
        const filters = [];
        let applyOnSelect = false;
        const chain = {
          eq(column, value) { filters.push({ column, op: 'eq', value }); return chain; },
          lte(column, value) { filters.push({ column, op: 'lte', value }); return chain; },
          is(column, value) { filters.push({ column, op: 'is', value }); return chain; },
          select() { applyOnSelect = true; return chain; },
          async maybeSingle() {
            const row = matching(filters)[0] || null;
            if (!row) return { data: null, error: null };
            const next = { ...row, ...patch };
            db.rows.set(db.keyOf(next), next);
            return { data: next, error: null };
          },
          then(resolve) {
            const rows = matching(filters);
            for (const row of rows) db.rows.set(db.keyOf(row), { ...row, ...patch });
            resolve({ data: applyOnSelect ? rows.map((row) => ({ ...row, ...patch })) : null, error: null });
          },
        };
        return chain;
      },
    };
  }
}

test('fresh reservation is explicitly ok and duplicate reservation remains terminal', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'ctrader', destinationRef: 'acct-1' });
  const first = await store.reserve('group:g1:leg:1', { command: 'OPEN' });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);

  const second = await store.reserve('group:g1:leg:1', { command: 'OPEN' });
  assert.equal(second.duplicate, true);
  assert.equal(second.result, undefined);
  assert.equal(second.row.status, 'PENDING');
});

test('complete stores broker result and later duplicate returns it', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'mt5', destinationRef: 'acct-2' });
  await store.reserve('k1');
  await store.complete('k1', { brokerPositionId: '123', success: true });
  const duplicate = await store.reserve('k1');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.result, { brokerPositionId: '123', success: true });
  assert.equal(duplicate.row.status, 'SUCCEEDED');
});

test('retryable delivery can be claimed exactly once when due and increments attempt count', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'mt5', destinationRef: 'acct-2' });
  await store.reserve('retry-1', { destinationType: 'mt5', action: { type: 'OPEN_POSITION' } });
  await store.markRetryable('retry-1', { code: 'BRIDGE_TIMEOUT' }, { nextAttemptAt: '2026-09-03T09:00:00.000Z' });

  const before = db.rows.get('ws1:retry-1');
  assert.equal(before.status, 'RETRYABLE');
  assert.equal(before.failure_class, 'RETRYABLE');
  assert.equal(before.error_code, 'BRIDGE_TIMEOUT');
  assert.equal(before.next_attempt_at, '2026-09-03T09:00:00.000Z');

  const first = await store.claimRetry('retry-1', {
    now: '2026-09-03T09:00:01.000Z',
    leaseUntil: '2026-09-03T09:01:01.000Z',
  });
  assert.equal(first.claimed, true);
  assert.equal(first.row.status, 'PENDING');
  assert.equal(first.row.attempt_count, 2);
  assert.equal(first.row.lease_expires_at, '2026-09-03T09:01:01.000Z');

  const second = await store.claimRetry('retry-1', {
    now: '2026-09-03T09:00:02.000Z',
    leaseUntil: '2026-09-03T09:01:02.000Z',
  });
  assert.equal(second.claimed, false);
});

test('retry claim fails closed before due time', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'mt5', destinationRef: 'acct-2' });
  await store.reserve('retry-later');
  await store.markRetryable('retry-later', { error: 'temporary' }, { nextAttemptAt: '2026-09-03T10:00:00.000Z' });

  const result = await store.claimRetry('retry-later', {
    now: '2026-09-03T09:59:59.000Z',
    leaseUntil: '2026-09-03T10:00:59.000Z',
  });
  assert.equal(result.claimed, false);
  assert.equal(db.rows.get('ws1:retry-later').status, 'RETRYABLE');
});

test('uncertain and terminal failed deliveries are never eligible for automatic retry', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'ctrader', destinationRef: 'acct-3' });

  await store.reserve('uncertain-1');
  await store.markUncertain('uncertain-1', { code: 'POST_SEND_TIMEOUT' });
  const uncertain = db.rows.get('ws1:uncertain-1');
  assert.equal(uncertain.status, 'UNCERTAIN');
  assert.equal(uncertain.failure_class, 'UNCERTAIN');
  assert.equal((await store.claimRetry('uncertain-1', { now: '2026-09-03T11:00:00.000Z', leaseUntil: '2026-09-03T11:01:00.000Z' })).claimed, false);

  await store.reserve('failed-1');
  await store.fail('failed-1', { code: 'BROKER_REJECTED' });
  const failed = db.rows.get('ws1:failed-1');
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failure_class, 'TERMINAL');
  assert.equal((await store.claimRetry('failed-1', { now: '2026-09-03T11:00:00.000Z', leaseUntil: '2026-09-03T11:01:00.000Z' })).claimed, false);
});

test('failure persistence keeps request authority but stores only bounded error metadata', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'mt5', destinationRef: 'acct-2' });
  await store.reserve('k2', { side: 'BUY' });
  await store.fail('k2', { error: 'bridge rejected' });
  const row = db.rows.get('ws1:k2');
  assert.equal(row.status, 'FAILED');
  assert.equal(row.error_code, 'bridge rejected');
  assert.equal(row.failure_class, 'TERMINAL');
  assert.deepEqual(row.request_payload, { side: 'BUY' });
});
