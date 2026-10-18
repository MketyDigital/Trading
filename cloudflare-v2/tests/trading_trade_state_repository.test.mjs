import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createTradingTradeStatePersistence } from '../src/persistence/trading_trade_state_repository.js';
import { applyTradingTradeStateReplicationEvent } from '../src/persistence/trading_trade_state_replication.js';

class SqliteD1 {
  constructor(sqlite) { this.sqlite = sqlite; this.prepared = []; }
  prepare(sql) {
    this.prepared.push(sql);
    const state = { sql, values: [] };
    const api = {
      sql,
      bind(...values) { state.values = values; return api; },
      first() { return this.sqlite.prepare(state.sql).get(...state.values) || null; },
      all() { return { results: this.sqlite.prepare(state.sql).all(...state.values) }; },
      run() { const result = this.sqlite.prepare(state.sql).run(...state.values); return { meta: { changes: Number(result.changes) } }; },
    };
    api.first = api.first.bind(this);
    api.all = api.all.bind(this);
    api.run = api.run.bind(this);
    return api;
  }
  batch(statements) {
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

function testStore({ failJournal = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0001_trading_storage_replication.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../db/d1-migrations/0002_trading_domain_schema.sql', import.meta.url), 'utf8'));
  sqlite.prepare(`UPDATE trading_storage_control SET writes_fenced=0 WHERE singleton_id=1`).run();
  sqlite.prepare(`INSERT INTO trading_workspace_access(id) VALUES ('workspace-1')`).run();
  sqlite.prepare(`INSERT INTO trade_accounts(id, workspace_id, account_label, platform, account_id, environment) VALUES ('account-1', 'workspace-1', 'Demo', 'mt5', '123', 'DEMO')`).run();
  const binding = new SqliteD1(sqlite);
  if (failJournal) {
    const originalBatch = binding.batch.bind(binding);
    binding.batch = statements => {
      const journalStatements = statements.slice(-2);
      assert.ok(journalStatements.some(statement => statement.sql.includes('INSERT INTO trading_replication_journal')));
      throw new Error('outbox unavailable');
    };
    binding.restoreBatch = originalBatch;
  }
  return { sqlite, binding, authority: { kind: 'd1', binding, authorityEpoch: 1 } };
}

const group = {
  id: 'signal-1:account-1', workspaceId: 'workspace-1', tradeAccountId: 'account-1',
  symbol: 'EURJPY', side: 'BUY', orderType: 'MARKET', status: 'OPEN', entry: { kind: 'PRICE', value: 160.25 },
  entryPrice: 160.25, stopLoss: 159.8, riskPlan: { logicalTakeProfits: [160.7, 161.1] },
  legs: [{ legId: 'signal-1:leg-1', targetIndex: 1, lots: 0.02, status: 'OPEN', brokerPositionId: 'position-1', takeProfit: 160.7 }],
};

test('D1 trade state saves group, legs and passive outbox atomically, then hydrates the group', async () => {
  const setup = testStore();
  const store = createTradingTradeStatePersistence({ authority: setup.authority, idFactory: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  await store.saveGroup(group);
  const saved = await store.loadGroup(group.workspaceId, group.id);
  assert.equal(saved.id, group.id);
  assert.equal(saved.legs[0].brokerPositionId, 'position-1');
  assert.deepEqual(saved.riskPlan.logicalTakeProfits, [160.7, 161.1]);
  const beforeActive = setup.binding.prepared.length;
  assert.equal((await store.loadActive(group.workspaceId)).length, 1);
  assert.equal(setup.binding.prepared.slice(beforeActive).filter(sql => sql.includes('FROM position_groups g LEFT JOIN position_legs')).length, 1);
  const candidates = await store.listBrokerTpProtectionCandidates({ pageSize: 10 });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].takeProfit, 160.7);
  const journal = setup.sqlite.prepare(`SELECT entity_type, payload_json FROM trading_replication_journal`).get();
  assert.equal(journal.entity_type, 'trade_state_group');
  assert.equal(JSON.parse(journal.payload_json).legs[0].broker_position_id, 'position-1');
  setup.sqlite.close();
});

test('D1 trade state rolls back group and legs if outbox append fails', async () => {
  const setup = testStore({ failJournal: true });
  const store = createTradingTradeStatePersistence({ authority: setup.authority, idFactory: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  await assert.rejects(() => store.saveGroup(group), /outbox unavailable/);
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM position_groups`).get().n, 0);
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM position_legs`).get().n, 0);
  setup.sqlite.close();
});

test('D1 trade state updates the existing logical group and preserves broker evidence omitted by a stale save', async () => {
  const setup = testStore();
  let sequence = 0;
  const store = createTradingTradeStatePersistence({ authority: setup.authority, idFactory: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12, '0')}` });
  await store.saveGroup({ ...group, legs: [{ ...group.legs[0], lastBrokerObservedAt: 1_760_000_000_000, lastBrokerStatus: 'PARTIALLY_FILLED', lastBrokerSourceVersion: 'broker-v2' }] });
  await store.saveGroup(group);
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM position_groups`).get().n, 1);
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM position_legs`).get().n, 1);
  const row = setup.sqlite.prepare(`SELECT last_broker_status, last_broker_source_version FROM position_legs`).get();
  assert.equal(row.last_broker_status, 'PARTIALLY_FILLED');
  assert.equal(row.last_broker_source_version, 'broker-v2');
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM trading_replication_journal`).get().n, 2);
  setup.sqlite.close();
});

test('D1 trade state refuses writes after the persisted authority is fenced', async () => {
  const setup = testStore();
  const store = createTradingTradeStatePersistence({ authority: setup.authority });
  setup.sqlite.prepare(`UPDATE trading_storage_control SET writes_fenced=1 WHERE singleton_id=1`).run();
  await assert.rejects(() => store.saveGroup(group), /write-fenced/);
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM position_groups`).get().n, 0);
  setup.sqlite.close();
});

test('D1 pending lifecycle query returns only explicitly tracked broker orders', async () => {
  const setup = testStore();
  const store = createTradingTradeStatePersistence({ authority: setup.authority, idFactory: () => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
  await store.saveGroup({ ...group, status: 'PENDING', legs: [{ ...group.legs[0], status: 'PENDING', lifecycleTrackingEnabled: true, brokerOrderId: 'pending-1' }] });
  const orders = await store.listPendingOrderLifecycles();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].brokerOrderId, 'pending-1');
  assert.equal(orders[0].groupId, group.id);
  setup.sqlite.close();
});

function postgresStore({ failJournal = false } = {}) {
  const calls = [];
  const db = {
    async query(sql, values = []) {
      calls.push({ sql, values, tx: false });
      if (sql.includes('FROM trading_storage.authority_control')) return { rows: [{ activeAuthority: 'postgres', authorityEpoch: 1, writesFenced: false }] };
      return { rows: [] };
    },
    async transaction(work) {
      const result = await work(async (sql, values = []) => {
        calls.push({ sql, values, tx: true });
        if (sql.includes('FROM trading_storage.authority_control')) return { rows: [{ active_authority: 'postgres', authority_epoch: 1, writes_fenced: false }] };
        if (sql.includes('INSERT INTO trading_storage.position_groups')) return { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }] };
        if (sql.includes('SELECT last_sequence')) return { rows: [{ last_sequence: 0 }] };
        if (sql.includes('SELECT direction, authority_epoch AS')) return { rows: [] };
        if (sql.includes('INSERT INTO trading_storage.replication_journal')) {
          if (failJournal) throw new Error('outbox unavailable');
          return { rows: [{ direction: values[0], authorityEpoch: values[1], sequence: values[2], idempotencyKey: values[3], entityType: values[4], entityId: values[5], operation: values[6], payloadJson: values[7], createdAt: values[8] }] };
        }
        return { rows: [] };
      });
      return result;
    },
  };
  return { db, calls, authority: { kind: 'postgres', binding: { connectionString: 'postgres://test' }, authorityEpoch: 1 } };
}

test('PostgreSQL trade state writes group, legs and outbox in one authority-locked transaction', async () => {
  const setup = postgresStore();
  const store = createTradingTradeStatePersistence({ authority: setup.authority, postgresDatabase: setup.db, idFactory: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
  await store.saveGroup(group);
  const transactional = setup.calls.filter(call => call.tx);
  assert.ok(transactional.some(call => call.sql.includes('FOR SHARE')));
  assert.ok(transactional.some(call => call.sql.includes('INSERT INTO trading_storage.position_groups')));
  assert.ok(transactional.some(call => call.sql.includes('INSERT INTO trading_storage.position_legs')));
  assert.ok(transactional.some(call => call.sql.includes('INSERT INTO trading_storage.replication_journal')));
});

test('PostgreSQL trade state propagates an outbox error so the transaction rolls back', async () => {
  const setup = postgresStore({ failJournal: true });
  const store = createTradingTradeStatePersistence({ authority: setup.authority, postgresDatabase: setup.db });
  await assert.rejects(() => store.saveGroup(group), /outbox unavailable/);
  assert.ok(setup.calls.some(call => call.tx && call.sql.includes('INSERT INTO trading_storage.position_groups')));
});

test('PostgreSQL-origin trade state events apply idempotently to fenced passive D1 without creating a second outbox event', async () => {
  const setup = testStore();
  setup.sqlite.prepare(`UPDATE trading_storage_control SET active_authority='postgres', writes_fenced=1 WHERE singleton_id=1`).run();
  const event = {
    direction: 'postgres_to_d1', authorityEpoch: 1, entityType: 'trade_state_group',
    entityId: `${group.workspaceId}:${group.id}`, operation: 'upsert',
    payload: { group: { workspace_id: group.workspaceId, runtime_group_id: group.id, trade_account_id: group.tradeAccountId, canonical_symbol: group.symbol, side: group.side, order_type: group.orderType, entry: group.entry, stop_loss: group.stopLoss, status: group.status, risk_plan: group.riskPlan, policy_snapshot: {}, source_event_ids: [], incomplete: false, position_mode: 'HEDGED' },
      legs: [{ workspace_id: group.workspaceId, runtime_leg_id: 'signal-1:leg-1', target_index: 1, lots: 0.02, remaining_lots: 0.02, status: 'OPEN', broker_position_id: 'position-1', take_profit: 160.7, lifecycle_tracking_enabled: false }] },
  };
  const target = { kind: 'd1', binding: setup.binding, authorityEpoch: 1 };
  await applyTradingTradeStateReplicationEvent(event, { targetAuthority: target, idFactory: () => 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  await applyTradingTradeStateReplicationEvent(event, { targetAuthority: target, idFactory: () => 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM position_groups`).get().n, 1);
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM position_legs`).get().n, 1);
  assert.equal(setup.sqlite.prepare(`SELECT COUNT(*) AS n FROM trading_replication_journal`).get().n, 0);
  setup.sqlite.close();
});

test('replication apply rejects stale epochs and events sent toward the active primary', async () => {
  const setup = testStore();
  const baseGroup = { workspace_id: 'workspace-1', runtime_group_id: 'group', canonical_symbol: 'EURJPY', side: 'BUY', order_type: 'MARKET' };
  const event = { authorityEpoch: 1, direction: 'd1_to_postgres', entityType: 'trade_state_group', entityId: 'workspace-1:group', operation: 'upsert', payload: { group: baseGroup, legs: [] } };
  await assert.rejects(() => applyTradingTradeStateReplicationEvent(event, { targetAuthority: setup.authority }), /target authority does not match/);
  setup.sqlite.prepare(`UPDATE trading_storage_control SET active_authority='postgres', authority_epoch=2 WHERE singleton_id=1`).run();
  const reverse = { ...event, authorityEpoch: 2, direction: 'postgres_to_d1', entityId: 'workspace-1:group' };
  await assert.rejects(() => applyTradingTradeStateReplicationEvent(reverse, { targetAuthority: { ...setup.authority, authorityEpoch: 1 } }), /authority epoch/);
  setup.sqlite.close();
});

test('D1-origin trade state events apply in one transaction to the passive PostgreSQL target', async () => {
  const calls = [];
  const db = {
    async transaction(work) {
      return work(async (sql, values = []) => {
        calls.push({ sql, values });
        if (sql.includes('FROM trading_storage.authority_control')) return { rows: [{ active_authority: 'd1', authority_epoch: 1 }] };
        if (sql.includes('INSERT INTO trading_storage.position_groups')) return { rows: [{ id: 'abababab-abab-4bab-8bab-abababababab' }] };
        return { rows: [] };
      });
    },
  };
  const event = {
    direction: 'd1_to_postgres', authorityEpoch: 1, entityType: 'trade_state_group',
    entityId: `${group.workspaceId}:${group.id}`, operation: 'upsert',
    payload: { group: { workspace_id: group.workspaceId, runtime_group_id: group.id, trade_account_id: group.tradeAccountId, canonical_symbol: group.symbol, side: group.side, order_type: group.orderType },
      legs: [{ workspace_id: group.workspaceId, runtime_leg_id: 'leg-1', target_index: 1, lots: 0.02, status: 'OPEN' }] },
  };
  const result = await applyTradingTradeStateReplicationEvent(event, { targetAuthority: { kind: 'postgres', binding: { connectionString: 'postgres://test' }, authorityEpoch: 1 }, postgresDatabase: db });
  assert.equal(result.applied, true);
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO trading_storage.position_groups')));
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO trading_storage.position_legs')));
  assert.ok(!calls.some(call => call.sql.includes('replication_journal')));
});
