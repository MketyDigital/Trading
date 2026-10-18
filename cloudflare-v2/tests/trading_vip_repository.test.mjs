import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTradingVIPRepository } from '../src/persistence/trading_vip_repository.js';
import { applyTradingReplicationEvent } from '../src/persistence/trading_replication_dispatcher.js';

class D1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const state = { sql, values: [] };
    const stmt = {
      bind: (...values) => { state.values = values; return stmt; },
      first: () => this.sqlite.prepare(state.sql).get(...state.values) || null,
      all: () => ({ results: this.sqlite.prepare(state.sql).all(...state.values) }),
      run: () => ({ meta: { changes: Number(this.sqlite.prepare(state.sql).run(...state.values).changes) } }),
    };
    return stmt;
  }
  batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const result = statements.map((statement) => statement.run()); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_trading_storage_replication.sql', '0002_trading_domain_schema.sql']) {
    sqlite.exec(readFileSync(new URL(`../db/d1-migrations/${file}`, import.meta.url), 'utf8'));
  }
  sqlite.prepare('UPDATE trading_storage_control SET writes_fenced=0 WHERE singleton_id=1').run();
  sqlite.prepare("INSERT INTO workspaces(id,name,owner_email,tier) VALUES('ws-a','Tenant A','a@example.com','free'),('ws-b','Tenant B','b@example.com','free')").run();
  const binding = new D1(sqlite);
  const authority = { kind: 'd1', binding, authorityEpoch: 1 };
  return { sqlite, binding, authority, repo: createTradingVIPRepository({ authority, idFactory: (() => { let n = 0; return () => `vip-${++n}`; })(), now: () => '2026-10-17T00:00:00.000Z' }) };
}

test('VIP membership reads and writes stay workspace scoped and journal atomically', async () => {
  const active = setup();
  const member = await active.repo.upsertMembership({ workspace_id: 'ws-a', telegram_id: 42, status: 'trial', trial_used: true, subscription_tier: 'trial', expires_at: '2026-10-20T00:00:00.000Z' });
  assert.equal(member.workspace_id, 'ws-a');
  assert.equal(await active.repo.getMembership('ws-b', 42), null);
  assert.equal((await active.repo.listExpiring('ws-a', '2026-10-18T00:00:00.000Z', '2026-10-21T00:00:00.000Z')).length, 1);
  assert.equal(active.sqlite.prepare('SELECT COUNT(*) AS n FROM trading_replication_journal').get().n, 1);
  active.sqlite.close();
});

test('VIP deposits are scoped, status transitions are pending-only, and events replay to passive D1', async () => {
  const active = setup();
  const passive = setup();
  passive.sqlite.prepare("UPDATE trading_storage_control SET active_authority='postgres' WHERE singleton_id=1").run();
  const deposit = await active.repo.createDeposit({ workspace_id: 'ws-a', telegram_id: 42, username: 'trader', amount: '10.00', plan_requested: '1 Month', receipt_photo_file_id: 'private-file-id' });
  assert.equal(await active.repo.reviewDeposit('ws-b', deposit.id, 'approved'), null);
  assert.equal((await active.repo.reviewDeposit('ws-a', deposit.id, 'approved')).status, 'approved');
  assert.equal(await active.repo.reviewDeposit('ws-a', deposit.id, 'rejected'), null);
  const entries = active.sqlite.prepare("SELECT authority_epoch,idempotency_key,entity_type,entity_id,operation,payload_json FROM trading_replication_journal WHERE entity_type LIKE 'trading_vip_%' ORDER BY sequence").all();
  assert.equal(entries.length, 2);
  for (const entry of entries) await applyTradingReplicationEvent({ direction: 'postgres_to_d1', authorityEpoch: entry.authority_epoch, idempotencyKey: entry.idempotency_key, entityType: entry.entity_type, entityId: entry.entity_id, operation: entry.operation, payload: JSON.parse(entry.payload_json) }, { targetAuthority: { kind: 'd1', binding: passive.binding, authorityEpoch: 1 } });
  assert.equal(passive.sqlite.prepare('SELECT status FROM bank_deposits WHERE id=?').get(deposit.id).status, 'approved');
  assert.equal(passive.sqlite.prepare('SELECT COUNT(*) AS n FROM trading_replication_journal').get().n, 0);
  active.sqlite.close(); passive.sqlite.close();
});
