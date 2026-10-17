import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresReplicationJournal } from '../src/persistence/postgres_replication_journal.js';

class FakePostgresDatabase {
  constructor() { this.counters = new Map(); this.rows = []; this.statements = []; }
  transaction(work) { return work(this.query.bind(this)); }
  async query(sql, values = []) {
    this.statements.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
    if (sql.includes('INSERT INTO trading_storage.replication_counters')) {
      const key = `${values[0]}:${values[1]}`;
      if (!this.counters.has(key)) this.counters.set(key, 0);
      return { rows: [] };
    }
    if (sql.includes('SELECT last_sequence')) return { rows: [{ last_sequence: this.counters.get(`${values[0]}:${values[1]}`) }] };
    if (sql.includes('SELECT direction') && sql.includes('idempotency_key = $3')) {
      const row = this.rows.find(item => item.direction === values[0] && item.authorityEpoch === values[1] && item.idempotencyKey === values[2]);
      return { rows: row ? [{ ...row, payloadJson: row.payload }] : [] };
    }
    if (sql.includes('UPDATE trading_storage.replication_counters')) {
      this.counters.set(`${values[0]}:${values[1]}`, values[2]);
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO trading_storage.replication_journal')) {
      const row = { direction: values[0], authorityEpoch: values[1], sequence: values[2], idempotencyKey: values[3], entityType: values[4], entityId: values[5], operation: values[6], payload: JSON.parse(values[7]), payloadJson: values[7], createdAt: values[8] };
      this.rows.push(row);
      return { rows: [{ ...row }] };
    }
    if (sql.includes('ORDER BY sequence ASC')) {
      return { rows: this.rows.filter(row => row.direction === values[0] && row.authorityEpoch === values[1] && row.sequence > values[2]).sort((a, b) => a.sequence - b.sequence).slice(0, values[3]).map(row => ({ ...row })) };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

test('PostgreSQL replication journal serializes duplicate idempotency keys without sequence holes', async () => {
  const db = new FakePostgresDatabase();
  const journal = new PostgresReplicationJournal(db, { now: () => new Date('2026-10-16T00:00:00Z') });
  const base = { authorityEpoch: 2, direction: 'postgres_to_d1', entityType: 'position_group', operation: 'upsert' };
  const first = await journal.append({ ...base, idempotencyKey: 'g:1', entityId: 'g1', payload: { status: 'OPEN' } });
  const retry = await journal.append({ ...base, idempotencyKey: 'g:1', entityId: 'g1', payload: { status: 'OPEN' } });
  const second = await journal.append({ ...base, idempotencyKey: 'g:2', entityId: 'g2', payload: { status: 'CLOSED' } });
  assert.deepEqual([first.sequence, retry.sequence, second.sequence], [1, 1, 2]);
  assert.deepEqual([first.inserted, retry.inserted, second.inserted], [true, false, true]);
  await assert.rejects(() => journal.append({ ...base, idempotencyKey: 'g:1', entityId: 'g1', payload: { status: 'CLOSED' } }), /reused with a different mutation/);
  assert.deepEqual((await journal.readAfter({ direction: 'postgres_to_d1', authorityEpoch: 2 })).map(row => row.sequence), [1, 2]);
});

test('PostgreSQL replication journal rejects invalid direction and operation', async () => {
  const journal = new PostgresReplicationJournal(new FakePostgresDatabase());
  await assert.rejects(() => journal.append({ authorityEpoch: 1, direction: 'bad', idempotencyKey: 'x', entityType: 'x', entityId: 'x', operation: 'upsert', payload: {} }), /direction/);
  await assert.rejects(() => journal.append({ authorityEpoch: 1, direction: 'd1_to_postgres', idempotencyKey: 'x', entityType: 'x', entityId: 'x', operation: 'truncate', payload: {} }), /operation/);
});
