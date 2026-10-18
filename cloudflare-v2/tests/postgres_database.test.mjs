import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresTradingDatabase } from '../src/persistence/postgres_database.js';

class FakeClient {
  constructor(options) { this.options = options; this.calls = []; }
  async connect() { this.calls.push('connect'); }
  async query(text, values = []) { this.calls.push([text, values]); return { rows: [] }; }
  async end() { this.calls.push('end'); }
}

test('Postgres factory uses the dedicated Hyperdrive connection string and opens one client', async () => {
  const db = await createPostgresTradingDatabase({ connectionString: 'postgres://dedicated' }, { ClientClass: FakeClient });
  assert.equal(db.client.options.connectionString, 'postgres://dedicated');
  assert.deepEqual(db.client.calls, ['connect']);
  await db.close();
  assert.deepEqual(db.client.calls, ['connect', 'end']);
});

test('Postgres transaction commits only after successful callback', async () => {
  const db = await createPostgresTradingDatabase({ connectionString: 'postgres://dedicated' }, { ClientClass: FakeClient });
  const result = await db.transaction(async query => { await query('UPDATE trading_storage.x SET y = $1', [4]); return 'ok'; });
  assert.equal(result, 'ok');
  assert.deepEqual(db.client.calls.slice(1).map(x => Array.isArray(x) ? x[0] : x), [
    'BEGIN', 'UPDATE trading_storage.x SET y = $1', 'COMMIT',
  ]);
});

test('Postgres transaction rolls back and preserves the original callback error', async () => {
  const db = await createPostgresTradingDatabase({ connectionString: 'postgres://dedicated' }, { ClientClass: FakeClient });
  await assert.rejects(() => db.transaction(async () => { throw new Error('write failed'); }), /write failed/);
  assert.equal(db.client.calls.at(-1)[0], 'ROLLBACK');
});

test('Postgres database refuses missing Hyperdrive credentials', async () => {
  await assert.rejects(() => createPostgresTradingDatabase({}), /TRADING_PG/);
});
