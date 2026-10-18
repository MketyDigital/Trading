import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTradingReplicationRuntime } from '../src/persistence/trading_replication_runtime.js';

class LocalD1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      first() { return this.sqlite.prepare(sql).get(...values) || null; },
      all() { return { results: this.sqlite.prepare(sql).all(...values) }; },
      run() {
        const result = this.sqlite.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
    statement.first = statement.first.bind(this);
    statement.all = statement.all.bind(this);
    statement.run = statement.run.bind(this);
    return statement;
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

function makeRuntime({ poisonEvent = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0001_trading_storage_replication.sql',
    '0002_trading_domain_schema.sql',
    '0003_trading_replication_health.sql',
  ]) {
    sqlite.exec(readFileSync(new URL(`../db/d1-migrations/${migration}`, import.meta.url), 'utf8'));
  }
  sqlite.prepare(`UPDATE trading_storage_control SET writes_fenced=0 WHERE singleton_id=1`).run();
  if (poisonEvent) {
    sqlite.prepare(`INSERT INTO trading_replication_counters(direction,authority_epoch,last_sequence) VALUES('d1_to_postgres',1,1)`).run();
    sqlite.prepare(`INSERT INTO trading_replication_journal(direction,authority_epoch,sequence,idempotency_key,entity_type,entity_id,operation,payload_json,created_at)
      VALUES('d1_to_postgres',1,1,'poison-1','unsupported_entity','row-1','upsert','{}','2026-10-17T00:00:00.000Z')`).run();
  }
  const DB = new LocalD1(sqlite);
  const postgresDatabase = {
    async query() { throw new Error('PostgreSQL must not be queried for D1-only empty/poison replay'); },
    async transaction() { throw new Error('PostgreSQL must not be transacted for D1-only empty/poison replay'); },
  };
  return {
    sqlite,
    async create() {
      return createTradingReplicationRuntime({
        DB,
        TRADING_PG: { connectionString: 'postgres://test-only.invalid' },
        TRADING_STORAGE_AUTHORITY: 'd1',
      }, { postgresDatabase, maxPages: 2, pageSize: 10 });
    },
  };
}

test('replication runtime verifies D1 authority and records a healthy empty backlog', async () => {
  const setup = makeRuntime();
  try {
    const runtime = await setup.create();
    const result = await runtime.run();
    assert.deepEqual(result, {
      authority: 'd1', direction: 'd1_to_postgres', checkpoint: 0,
      pages: 1, applied: 0, hasMore: false, lag: 0, ok: true,
    });
    const health = setup.sqlite.prepare(`SELECT source_sequence,applied_sequence,last_error_code FROM trading_replication_health`).get();
    assert.equal(health.source_sequence, 0);
    assert.equal(health.applied_sequence, 0);
    assert.equal(health.last_error_code, null);
    await runtime.close();
  } finally {
    setup.sqlite.close();
  }
});

test('poison replication event is quarantined without advancing its checkpoint and reports lag', async () => {
  const setup = makeRuntime({ poisonEvent: true });
  try {
    const runtime = await setup.create();
    const result = await runtime.run();
    assert.equal(result.ok, false);
    assert.equal(result.blocked.sequence, 1);
    assert.equal(result.lag, 1);
    assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS count FROM trading_replication_quarantine`).get().count, 1);
    assert.equal(setup.sqlite.prepare(`SELECT attempts FROM trading_replication_quarantine`).get().attempts, 1);
    const retryResult = await runtime.run();
    assert.equal(retryResult.ok, false);
    assert.equal(setup.sqlite.prepare(`SELECT attempts FROM trading_replication_quarantine`).get().attempts, 2);
    assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS count FROM trading_replication_checkpoints`).get().count, 0);
    const health = setup.sqlite.prepare(`SELECT source_sequence,applied_sequence,last_error_code FROM trading_replication_health`).get();
    assert.equal(health.source_sequence, 1);
    assert.equal(health.applied_sequence, 0);
    assert.equal(health.last_error_code, 'REPLICATION_APPLY_FAILED');
    await runtime.close();
  } finally {
    setup.sqlite.close();
  }
});
