import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { D1ReplicationJournal } from '../src/persistence/d1_replication_journal.js';

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0001_trading_storage_replication.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      first() { return sqlite.prepare(sql).get(...values) || null; },
      all() { return { results: sqlite.prepare(sql).all(...values) }; },
      run() { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
    };
  };
  return {
    prepare,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close() { sqlite.close(); },
  };
}

test('D1 replication append retries are idempotent and do not create sequence holes', async () => {
  const db = makeD1();
  const journal = new D1ReplicationJournal(db, { now: () => '2026-10-16T00:00:00.000Z' });
  const base = { authorityEpoch: 4, direction: 'd1_to_postgres', entityType: 'trade_event', entityId: 'event-1', operation: 'upsert' };
  const first = await journal.append({ ...base, idempotencyKey: 'event:1', payload: { status: 'READY' } });
  const retry = await journal.append({ ...base, idempotencyKey: 'event:1', payload: { status: 'READY' } });
  const second = await journal.append({ ...base, entityId: 'event-2', idempotencyKey: 'event:2', payload: { status: 'MANAGEMENT' } });

  assert.equal(first.sequence, 1);
  assert.equal(first.inserted, true);
  assert.equal(retry.sequence, 1);
  assert.equal(retry.inserted, false);
  await assert.rejects(() => journal.append({ ...base, idempotencyKey: 'event:1', payload: { status: 'CLOSED' } }), /reused with a different mutation/);
  assert.equal(second.sequence, 2);
  assert.deepEqual((await journal.readAfter({ direction: 'd1_to_postgres', authorityEpoch: 4, sequence: 0 })).map(row => row.sequence), [1, 2]);
  db.close();
});

test('D1 replication journal validates direction, epoch, and required mutation identity', async () => {
  const db = makeD1();
  const journal = new D1ReplicationJournal(db);
  await assert.rejects(() => journal.append({}), /authorityEpoch is required/);
  await assert.rejects(() => journal.append({ authorityEpoch: 0, direction: 'd1_to_postgres', idempotencyKey: 'x', entityType: 'x', entityId: 'x', operation: 'upsert', payload: {} }), /epoch/);
  await assert.rejects(() => journal.append({ authorityEpoch: 1, direction: 'unknown', idempotencyKey: 'x', entityType: 'x', entityId: 'x', operation: 'upsert', payload: {} }), /direction/);
  db.close();
});
