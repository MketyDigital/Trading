import test from 'node:test';
import assert from 'node:assert/strict';

import { SupabaseDeliveryStore } from '../src/persistence/supabase_delivery_store.js';

class FakeSupabase {
  constructor(row) { this.row = { ...row }; }
  from(name) {
    assert.equal(name, 'destination_deliveries');
    const db = this;
    return {
      select() {
        const filters = [];
        const chain = {
          eq(column, value) { filters.push([column, value]); return chain; },
          async maybeSingle() {
            const matches = filters.every(([column, value]) => String(db.row?.[column]) === String(value));
            return { data: matches ? { ...db.row } : null, error: null };
          },
        };
        return chain;
      },
      update(patch) {
        const filters = [];
        const chain = {
          eq(column, value) { filters.push([column, value]); return chain; },
          select() { return chain; },
          async maybeSingle() {
            const matches = filters.every(([column, value]) => String(db.row?.[column]) === String(value));
            if (!matches) return { data: null, error: null };
            db.row = { ...db.row, ...patch };
            return { data: { ...db.row }, error: null };
          },
        };
        return chain;
      },
    };
  }
}

function pendingRow(overrides = {}) {
  return {
    id: 'delivery-1',
    workspace_id: 'ws-1',
    destination_type: 'mt5',
    destination_ref: 'trade-account:acc-1',
    idempotency_key: 'retry-key-1',
    status: 'PENDING',
    attempt_count: 5,
    next_attempt_at: null,
    lease_expires_at: '2026-09-03T09:59:00.000Z',
    ...overrides,
  };
}

test('expired PENDING retry lease can be reclaimed without consuming another logical retry attempt', async () => {
  const db = new FakeSupabase(pendingRow());
  const store = new SupabaseDeliveryStore(db, {
    workspaceId: 'ws-1', destinationType: 'mt5', destinationRef: 'trade-account:acc-1',
  });

  const claim = await store.claimRetry('retry-key-1', {
    now: '2026-09-03T10:00:00.000Z',
    leaseUntil: '2026-09-03T10:01:00.000Z',
  });

  assert.equal(claim.claimed, true);
  assert.equal(claim.row.status, 'PENDING');
  assert.equal(claim.row.attempt_count, 5);
  assert.equal(claim.row.lease_expires_at, '2026-09-03T10:01:00.000Z');
  assert.equal(claim.row.next_attempt_at, null);
});

test('live PENDING retry lease cannot be stolen by another worker', async () => {
  const db = new FakeSupabase(pendingRow({ lease_expires_at: '2026-09-03T10:02:00.000Z' }));
  const store = new SupabaseDeliveryStore(db, {
    workspaceId: 'ws-1', destinationType: 'mt5', destinationRef: 'trade-account:acc-1',
  });

  const claim = await store.claimRetry('retry-key-1', {
    now: '2026-09-03T10:00:00.000Z',
    leaseUntil: '2026-09-03T10:01:00.000Z',
  });

  assert.equal(claim.claimed, false);
  assert.equal(db.row.lease_expires_at, '2026-09-03T10:02:00.000Z');
  assert.equal(db.row.attempt_count, 5);
});
