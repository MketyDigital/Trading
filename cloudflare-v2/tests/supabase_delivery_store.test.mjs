import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseDeliveryStore } from '../src/persistence/supabase_delivery_store.js';

class FakeSupabase {
  constructor() { this.rows = new Map(); }
  from(name) {
    assert.equal(name, 'destination_deliveries');
    const db = this;
    return {
      insert(values) {
        return {
          async select() {
            const row = Array.isArray(values) ? values[0] : values;
            const key = `${row.workspace_id}:${row.idempotency_key}`;
            if (db.rows.has(key)) return { data: null, error: { code: '23505', message: 'duplicate' } };
            const saved = { id: `id-${db.rows.size + 1}`, ...row };
            db.rows.set(key, saved);
            return { data: [saved], error: null };
          }
        };
      },
      select() {
        let workspaceId; let key;
        const chain = {
          eq(column, value) { if (column === 'workspace_id') workspaceId = value; if (column === 'idempotency_key') key = value; return chain; },
          async maybeSingle() { return { data: db.rows.get(`${workspaceId}:${key}`) || null, error: null }; },
        };
        return chain;
      },
      update(patch) {
        let workspaceId; let key;
        const chain = {
          eq(column, value) {
            if (column === 'workspace_id') workspaceId = value;
            if (column === 'idempotency_key') key = value;
            if (workspaceId && key) {
              const mapKey = `${workspaceId}:${key}`;
              const existing = db.rows.get(mapKey);
              if (existing) db.rows.set(mapKey, { ...existing, ...patch });
            }
            return chain;
          },
          then(resolve) { resolve({ data: null, error: null }); },
        };
        return chain;
      },
    };
  }
}

test('atomically reserves a destination idempotency key and detects duplicate', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'ctrader', destinationRef: 'acct-1' });
  const first = await store.reserve('group:g1:leg:1', { command: 'OPEN' });
  assert.equal(first.duplicate, false);
  const second = await store.reserve('group:g1:leg:1', { command: 'OPEN' });
  assert.equal(second.duplicate, true);
  assert.equal(second.result, undefined);
});

test('complete stores broker result and later duplicate returns it', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'mt5', destinationRef: 'acct-2' });
  await store.reserve('k1');
  await store.complete('k1', { brokerPositionId: '123', success: true });
  const duplicate = await store.reserve('k1');
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.result, { brokerPositionId: '123', success: true });
});

test('fail records error and does not expose secrets in stored payload', async () => {
  const db = new FakeSupabase();
  const store = new SupabaseDeliveryStore(db, { workspaceId: 'ws1', destinationType: 'mt5', destinationRef: 'acct-2' });
  await store.reserve('k2', { side: 'BUY' });
  await store.fail('k2', { error: 'bridge rejected' });
  const row = db.rows.get('ws1:k2');
  assert.equal(row.status, 'FAILED');
  assert.equal(row.error_code, 'bridge rejected');
  assert.deepEqual(row.request_payload, { side: 'BUY' });
});
