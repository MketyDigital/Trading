import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTradingRuntimeControlStore } from '../src/persistence/trading_runtime_control_store.js';

class FakeD1 {
  constructor() { this.controls = new Map(); this.outbox = []; this.authority = { activeAuthority: 'd1', authorityEpoch: 1, writesFenced: 0 }; }
  prepare(sql) {
    const thisDb = this;
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      get sql() { return sql; },
      get values() { return values; },
      async first() {
        if (sql.includes('FROM trading_storage_control')) return thisDb.authority;
        if (sql.includes('FROM trading_runtime_controls')) return thisDb.controls.get(values[0]) || null;
        if (sql.includes('INSERT INTO trading_runtime_controls')) {
          const row = { control_key: values[0], enabled: values[1], updated_by: values[2], updated_at: values[3] };
          thisDb.controls.set(row.control_key, row);
          return row;
        }
        throw new Error(`Unexpected D1 SQL: ${sql}`);
      },
    };
  }
  async batch(statements) {
    const controls = new Map(this.controls);
    const outbox = [...this.outbox];
    try {
      const results = [];
      for (const statement of statements) {
        if (statement.sql.includes('INSERT INTO trading_runtime_controls')) {
          const [controlKey, enabled, updatedBy, updatedAt] = statement.values;
          if (this.authority.activeAuthority === 'd1' && this.authority.authorityEpoch === statement.values[4] && !this.authority.writesFenced) {
            this.controls.set(controlKey, { control_key: controlKey, enabled, updated_by: updatedBy, updated_at: updatedAt });
            results.push({ meta: { changes: 1 } });
          } else results.push({ meta: { changes: 0 } });
        } else if (statement.sql.includes('INSERT INTO trading_replication_journal')) {
          if (this.authority.activeAuthority === 'd1' && this.authority.authorityEpoch === statement.values.at(-1) && !this.authority.writesFenced) {
            this.outbox.push({ direction: statement.values[0], authorityEpoch: statement.values[1], idempotencyKey: statement.values[2] });
          }
          results.push({ meta: { changes: 1 } });
        } else results.push({ meta: { changes: 0 } });
      }
      return results;
    } catch (error) { this.controls = controls; this.outbox = outbox; throw error; }
    return [];
  }
}

class FakePostgres {
  constructor() { this.controls = new Map(); this.outbox = []; this.authority = { activeAuthority: 'postgres', authorityEpoch: '2', writesFenced: false }; }
  async transaction(fn) {
    const controls = new Map(this.controls); const outbox = [...this.outbox];
    try { return await fn(this.query.bind(this)); }
    catch (error) { this.controls = controls; this.outbox = outbox; throw error; }
  }
  async query(sql, values = []) {
    if (sql.includes('FROM trading_storage.authority_control')) return { rows: [this.authority] };
    if (sql.includes('FROM trading_storage.runtime_controls')) return { rows: this.controls.has(values[0]) ? [this.controls.get(values[0])] : [] };
    if (sql.includes('INSERT INTO trading_storage.runtime_controls')) {
      const row = { controlKey: values[0], enabled: values[1], updatedBy: values[2], updatedAt: values[3] };
      this.controls.set(values[0], row);
      return { rows: [row] };
    }
    if (sql.includes('INSERT INTO trading_storage.replication_counters')) return { rows: [] };
    if (sql.includes('SELECT last_sequence FROM trading_storage.replication_counters')) return { rows: [{ last_sequence: this.outbox.length }] };
    if (sql.includes('SELECT direction, authority_epoch AS "authorityEpoch"')) return { rows: [] };
    if (sql.includes('UPDATE trading_storage.replication_counters')) return { rows: [] };
    if (sql.includes('INSERT INTO trading_storage.replication_journal')) {
      if (this.failJournal) throw new Error('replication unavailable');
      this.outbox.push({ idempotencyKey: values[3], entityType: values[4], entityId: values[5], operation: values[6] });
      return { rows: [{ direction: values[0], authorityEpoch: values[1], sequence: values[2], idempotencyKey: values[3], entityType: values[4], entityId: values[5], operation: values[6], payloadJson: values[7], createdAt: values[8] }] };
    }
    throw new Error(`Unexpected PostgreSQL SQL: ${sql}`);
  }
}

function makeSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0001_trading_storage_replication.sql', import.meta.url), 'utf8'));
  sqlite.prepare(`UPDATE trading_storage_control SET active_authority = 'd1', authority_epoch = 1, writes_fenced = 0, updated_at = ? WHERE singleton_id = 1`).run('2026-10-17T00:00:00.000Z');
  return {
    sqlite,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        get sql() { return sql; },
        get values() { return values; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
      };
    },
    async batch(statements) {
      if (this.beforeBatch) await this.beforeBatch();
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => {
          const result = sqlite.prepare(statement.sql).run(...statement.values);
          return { meta: { changes: Number(result.changes) } };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
}

test('D1 foundation migration seeds D1 as the planned but fenced authority', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0001_trading_storage_replication.sql', import.meta.url), 'utf8'));
  assert.deepEqual({ ...sqlite.prepare('SELECT active_authority, authority_epoch, writes_fenced FROM trading_storage_control').get() }, {
    active_authority: 'd1', authority_epoch: 1, writes_fenced: 1,
  });
  assert.equal(sqlite.prepare('SELECT SUM(enabled) AS enabled FROM trading_runtime_controls').get().enabled, 0);
  sqlite.close();
});

test('D1 runtime-control store fails closed for missing rows and writes explicit values', async () => {
  const db = new FakeD1();
  const store = createTradingRuntimeControlStore({ authority: { kind: 'd1', authorityEpoch: 1, binding: db }, now: () => '2026-10-17T00:00:00.000Z' });
  assert.deepEqual(await store.getTradingAccessEnabled(), { ok: false, enabled: false, reason: 'RUNTIME_CONTROL_UNAVAILABLE' });
  assert.deepEqual(await store.setTradingAccessEnabled(true, { updatedBy: 'operator-1' }), { ok: true, enabled: true, updatedAt: '2026-10-17T00:00:00.000Z', updatedBy: 'operator-1' });
  assert.equal((await store.getTradingAccessEnabled()).enabled, true);
  assert.equal(db.outbox.length, 1);
});

test('D1 runtime-control store refuses to read or change controls after promotion fences it', async () => {
  const db = new FakeD1();
  const store = createTradingRuntimeControlStore({ authority: { kind: 'd1', authorityEpoch: 1, binding: db } });
  db.authority = { activeAuthority: 'postgres', authorityEpoch: 2, writesFenced: 1 };
  assert.equal((await store.getLiveBrokerExecutionEnabled()).ok, false);
  await assert.rejects(() => store.setLiveBrokerExecutionEnabled(true), /fenced by a different active authority/);
});

test('PostgreSQL runtime-control store uses the selected authority and maps database rows', async () => {
  const postgresDatabase = new FakePostgres();
  const store = createTradingRuntimeControlStore({
    authority: { kind: 'postgres', authorityEpoch: 2, binding: { connectionString: 'postgres://db' } },
    postgresDatabase,
    now: () => '2026-10-17T00:00:00.000Z',
  });
  assert.deepEqual(await store.setBrokerExecutionEnabled(true, { updatedBy: 'operator-2' }), { ok: true, enabled: true, updatedAt: '2026-10-17T00:00:00.000Z', updatedBy: 'operator-2' });
  assert.equal((await store.getBrokerExecutionEnabled()).enabled, true);
  assert.equal(postgresDatabase.outbox.length, 1);
});

test('PostgreSQL runtime-control store returns unavailable when the selected authority is fenced', async () => {
  const postgresDatabase = new FakePostgres();
  postgresDatabase.authority = { activeAuthority: 'postgres', authorityEpoch: '2', writesFenced: true };
  const store = createTradingRuntimeControlStore({ authority: { kind: 'postgres', authorityEpoch: 2, binding: {} }, postgresDatabase });
  assert.equal((await store.getBrokerExecutionEnabled()).ok, false);
  await assert.rejects(() => store.setBrokerExecutionEnabled(true), /write-fenced/);
});

test('D1 runtime-control SQL runs against SQLite with disabled-by-default safety gates', async () => {
  const binding = makeSqliteD1();
  const store = createTradingRuntimeControlStore({ authority: { kind: 'd1', authorityEpoch: 1, binding }, now: () => '2026-10-17T00:00:00.000Z' });
  assert.equal((await store.getTradingAccessEnabled()).enabled, false);
  assert.equal((await store.getBrokerExecutionEnabled()).enabled, false);
  assert.equal((await store.getLiveBrokerExecutionEnabled()).enabled, false);
  assert.equal((await store.setTradingAccessEnabled(true)).enabled, true);
  assert.equal((await store.setTradingAccessEnabled(false)).enabled, false);
  binding.close();
});

test('D1 runtime-control update rolls back when its replication event fails', async () => {
  const binding = makeSqliteD1();
  const store = createTradingRuntimeControlStore({ authority: { kind: 'd1', authorityEpoch: 1, binding }, now: () => '2026-10-17T00:00:00.000Z' });
  binding.sqlite.exec(`CREATE TRIGGER reject_replication BEFORE INSERT ON trading_replication_journal BEGIN SELECT RAISE(ABORT, 'replication unavailable'); END`);
  await assert.rejects(() => store.setTradingAccessEnabled(true), /replication unavailable/);
  assert.equal((await store.getTradingAccessEnabled()).enabled, false);
  binding.close();
});

test('D1 runtime-control update is fenced if authority changes after preflight', async () => {
  const binding = makeSqliteD1();
  const store = createTradingRuntimeControlStore({ authority: { kind: 'd1', authorityEpoch: 1, binding }, now: () => '2026-10-17T00:00:00.000Z' });
  binding.beforeBatch = async () => binding.sqlite.prepare(`UPDATE trading_storage_control SET active_authority = 'postgres', authority_epoch = 2, writes_fenced = 1 WHERE singleton_id = 1`).run();
  await assert.rejects(() => store.setTradingAccessEnabled(true), /authority changed during runtime-control update/);
  assert.equal((await binding.sqlite.prepare(`SELECT enabled FROM trading_runtime_controls WHERE control_key = 'trading_access_enabled'`).get()).enabled, 0);
  assert.equal((await binding.sqlite.prepare(`SELECT COUNT(*) AS count FROM trading_replication_journal`).get()).count, 0);
  binding.close();
});

test('PostgreSQL runtime-control update rolls back when its replication event fails', async () => {
  const postgresDatabase = new FakePostgres();
  postgresDatabase.failJournal = true;
  const store = createTradingRuntimeControlStore({ authority: { kind: 'postgres', authorityEpoch: 2, binding: {} }, postgresDatabase });
  await assert.rejects(() => store.setBrokerExecutionEnabled(true), /replication unavailable/);
  assert.equal((await store.getBrokerExecutionEnabled()).enabled, false);
  assert.equal(postgresDatabase.outbox.length, 0);
});
