import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTradingAccountFollowerRepository } from '../src/persistence/trading_account_follower_repository.js';

class D1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const state = { sql, values: [] };
    const api = {
      bind: (...values) => { state.values = values; return api; },
      first: () => this.sqlite.prepare(state.sql).get(...state.values) || null,
      all: () => ({ results: this.sqlite.prepare(state.sql).all(...state.values) }),
      run: () => ({ meta: { changes: Number(this.sqlite.prepare(state.sql).run(...state.values).changes) } }),
    };
    return api;
  }
  batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const rows = statements.map((statement) => statement.run()); this.sqlite.exec('COMMIT'); return rows; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0001_trading_storage_replication.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0002_trading_domain_schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0004_account_followers.sql', import.meta.url), 'utf8'));
  sqlite.prepare(`UPDATE trading_storage_control SET writes_fenced=0 WHERE singleton_id=1`).run();
  sqlite.prepare(`INSERT INTO trading_workspace_access(id) VALUES ('ws')`).run();
  sqlite.prepare(`INSERT INTO trade_accounts(id,workspace_id,account_label,platform,account_id) VALUES ('parent','ws','Parent','mt5','1'),('follower','ws','Follower','mt5','2')`).run();
  const binding = new D1(sqlite);
  return { sqlite, store: createTradingAccountFollowerRepository({ authority: { kind: 'd1', binding, authorityEpoch: 1 }, idFactory: () => 'link-1', now: () => '2026-10-19T00:00:00.000Z' }) };
}

test('follower link repository enforces one parent per follower and batches parent lookup', async () => {
  const { sqlite, store } = setup();
  const row = await store.upsertLink('ws', { followerAccountId: 'follower', parentAccountId: 'parent', enabled: true, lotMultiplier: 0.5 });
  assert.equal(row.follower_account_id, 'follower');
  const links = await store.listEnabledByParents('ws', ['parent', 'missing']);
  assert.equal(links.length, 1);
  assert.equal(links[0].id, 'link-1');
  assert.equal(links[0].follower_account_id, 'follower');
  assert.equal(links[0].lot_multiplier, 0.5);
  const unchanged = await store.upsertLink('ws', { followerAccountId: 'follower', parentAccountId: 'parent', enabled: true, lotMultiplier: 0.5 });
  assert.equal(unchanged.id, 'link-1');
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM trading_replication_journal`).get().n, 1);
});

test('follower link repository rejects self and cross-workspace links', async () => {
  const { store } = setup();
  await assert.rejects(() => store.upsertLink('ws', { followerAccountId: 'parent', parentAccountId: 'parent' }), /FOLLOWER_LINK_SELF/);
  await assert.rejects(() => store.upsertLink('ws', { followerAccountId: 'follower', parentAccountId: 'unknown' }), /FOLLOWER_LINK_ACCOUNT_NOT_FOUND/);
});
