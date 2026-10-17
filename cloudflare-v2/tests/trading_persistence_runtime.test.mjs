import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTradingPersistenceRuntime } from '../src/persistence/trading_persistence_runtime.js';

class D1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const state = { sql, values: [] };
    const statement = {
      bind: (...values) => { state.values = values; return statement; },
      first: () => this.sqlite.prepare(state.sql).get(...state.values) || null,
      all: () => ({ results: this.sqlite.prepare(state.sql).all(...state.values) }),
      run: () => ({ meta: { changes: Number(this.sqlite.prepare(state.sql).run(...state.values).changes) } }),
    };
    return statement;
  }
  batch(statements) { return statements.map((statement) => statement.run()); }
}

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of ['0001_trading_storage_replication.sql', '0002_trading_domain_schema.sql']) sqlite.exec(readFileSync(new URL(`../db/d1-migrations/${name}`, import.meta.url), 'utf8'));
  sqlite.prepare('UPDATE trading_storage_control SET writes_fenced=0 WHERE singleton_id=1').run();
  return sqlite;
}

test('persistence runtime composes D1 repositories without creating Supabase or a second authority', async () => {
  const sqlite = database();
  const runtime = await createTradingPersistenceRuntime({ DB: new D1(sqlite) }, { masterKey: 'local-test-key' });
  assert.equal(runtime.authority.kind, 'd1');
  for (const key of ['accessCodes', 'accounts', 'aiProviders', 'destinations', 'ingest', 'legacyWorkspaces', 'runtimeControls', 'sourceConnections', 'tradeState', 'vip', 'workspaceAccess']) assert.ok(runtime[key], `${key} is composed`);
  assert.equal(typeof runtime.delivery, 'function');
  assert.equal((await runtime.runtimeControls.getTradingAccessEnabled()).ok, true);
  await runtime.close();
  sqlite.close();
});

test('persistence runtime fails closed when its explicit authority binding or encryption key is missing', async () => {
  await assert.rejects(() => createTradingPersistenceRuntime({}, { masterKey: 'key' }), /D1 binding/);
  await assert.rejects(() => createTradingPersistenceRuntime({ DB: new D1(database()) }), /TRADING_MASTER_KEY/);
});

test('persistence runtime can compose the alternate PostgreSQL authority through Hyperdrive', async () => {
  let connected = 0, closed = 0;
  class FakeClient {
    constructor(config) { assert.match(config.connectionString, /hyperdrive/); }
    async connect() { connected += 1; }
    async query() { return { rows: [] }; }
    async end() { closed += 1; }
  }
  const runtime = await createTradingPersistenceRuntime({ TRADING_STORAGE_AUTHORITY: 'postgres', TRADING_PG: { connectionString: 'postgres://hyperdrive' } }, { masterKey: 'local-test-key', ClientClass: FakeClient });
  assert.equal(runtime.authority.kind, 'postgres');
  assert.equal(connected, 1);
  await runtime.close();
  assert.equal(closed, 1);
});
