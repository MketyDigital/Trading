import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeStateStore, TradeStateCoordinator } from '../src/state/trade_state_store.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async delete(key) { return this.map.delete(key); }
  async list({ prefix = '' } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(prefix))); }
}

class MemoryPersistence {
  constructor(groups = []) { this.groups = new Map(groups.map((group) => [String(group.id), structuredClone(group)])); this.saved = []; }
  async saveGroup(group) { this.groups.set(String(group.id), structuredClone(group)); this.saved.push(structuredClone(group)); return group; }
  async loadGroup(workspaceId, groupId) {
    const group = this.groups.get(String(groupId));
    if (!group || String(group.workspaceId) !== String(workspaceId)) return null;
    return structuredClone(group);
  }
  async loadActive(workspaceId) {
    return [...this.groups.values()]
      .filter((group) => String(group.workspaceId) === String(workspaceId))
      .filter((group) => ['OPEN', 'PLANNED', 'PENDING'].includes(String(group.status)))
      .map((group) => structuredClone(group));
  }
}

const now = 1700000000000;

function fastGroup() {
  return {
    id: 'g1', workspaceId: 'ws1', sourceInstanceId: 'listener-1', sourceEventIds: ['100'],
    threadId: null, symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET', status: 'OPEN', incomplete: true,
    createdAt: now - 1000, updatedAt: now - 1000,
    legs: [{ legId: 'leg-1', targetIndex: 1, status: 'OPEN', brokerPositionId: 'p1', lots: 0.03 }],
  };
}

test('persists and reloads active position groups from durable storage', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup(fastGroup());
  assert.deepEqual(await store.getGroup('g1'), fastGroup());
  assert.deepEqual((await store.listActive()).map((g) => g.id), ['g1']);
});

test('does not persist an unchanged group twice in one durable-object lifetime', async () => {
  const persistence = new MemoryPersistence();
  const store = new TradeStateStore(new MemoryStorage(), { persistence });
  const group = fastGroup();
  await store.putGroup(group);
  await store.putGroup(structuredClone(group));
  assert.equal(persistence.saved.length, 1);
});

test('writes every state mutation through to durable relational persistence', async () => {
  const persistence = new MemoryPersistence();
  const store = new TradeStateStore(new MemoryStorage(), { persistence });
  await store.putGroup(fastGroup());
  await store.appendSourceEvent('g1', '101', now);
  await store.bindLegExecution('g1', 'leg-1', { brokerPositionId: 'p99', brokerOrderId: 'o88', brokerDealId: 'd77', actionType: 'OPEN_POSITION', executedLots: 0.03 }, now + 1);
  await store.setGroupStatus('g1', 'OPEN', now + 2);

  assert.equal(persistence.saved.length, 4);
  const persisted = await persistence.loadGroup('ws1', 'g1');
  assert.deepEqual(persisted.sourceEventIds, ['100', '101']);
  assert.equal(persisted.legs[0].brokerPositionId, 'p99');
  assert.equal(persisted.legs[0].brokerOrderId, 'o88');
  assert.equal(persisted.legs[0].brokerDealId, 'd77');
  assert.equal(persisted.updatedAt, now + 2);
});

test('broker observations update authoritative state monotonically and cannot roll back to an older poll', async () => {
  const persistence = new MemoryPersistence();
  const store = new TradeStateStore(new MemoryStorage(), { persistence });
  await store.putGroup(fastGroup());

  const newer = await store.recordBrokerObservation('g1', 'leg-1', {
    observedAt: now + 200,
    status: 'TP_CONFIRMED',
    sourceVersion: null,
    dealIds: ['deal-2'],
  });
  const older = await store.recordBrokerObservation('g1', 'leg-1', {
    observedAt: now + 100,
    status: 'UNRESOLVED',
    sourceVersion: 'BROKER_POSITION_HISTORY_UNAVAILABLE',
    dealIds: [],
  });

  assert.equal(newer.outcome, 'APPLIED');
  assert.equal(older.outcome, 'STALE');
  const leg = (await store.getGroup('g1')).legs[0];
  assert.equal(leg.lastBrokerObservedAt, now + 200);
  assert.equal(leg.lastBrokerStatus, 'TP_CONFIRMED');
  assert.deepEqual(leg.brokerDealIds, ['deal-2']);
});

test('broker protection observations update only the supplied leg protection fields', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  const group = fastGroup();
  group.legs[0].stopLoss = 1.09;
  group.legs[0].takeProfit = 1.12;
  await store.putGroup(group);
  await store.recordBrokerObservation('g1', 'leg-1', {
    observedAt: now + 300,
    status: 'PROTECTION_CHANGED',
    snapshotFingerprint: 'p1|1.105|unknown',
    stopLoss: 1.105,
  });
  const leg = (await store.getGroup('g1')).legs[0];
  assert.equal(leg.stopLoss, 1.105);
  assert.equal(leg.takeProfit, 1.12);
});

test('recovers an individual group from relational persistence when local durable state is missing', async () => {
  const persistence = new MemoryPersistence([fastGroup()]);
  const storage = new MemoryStorage();
  const store = new TradeStateStore(storage, { persistence, workspaceId: 'ws1' });

  assert.deepEqual(await store.getGroup('g1'), fastGroup());
  assert.deepEqual(await storage.get('group:g1'), fastGroup());
});

test('hydrates active groups from relational persistence so reply correlation survives local state loss', async () => {
  const persistence = new MemoryPersistence([fastGroup()]);
  const store = new TradeStateStore(new MemoryStorage(), { persistence, workspaceId: 'ws1' });
  const coordinator = new TradeStateCoordinator(store, { correlationWindowMs: 120000 });

  const result = await coordinator.correlate({
    workspace_hint: 'ws1',
    source: { instance_id: 'listener-1' }, external_event_id: '101',
    thread: { reply_to_event_id: '100' },
  }, {
    status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' },
  }, now);

  assert.deepEqual(result, { status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'g1' });
  assert.deepEqual((await store.listActive()).map((group) => group.id), ['g1']);
});

test('appends source event ids idempotently and updates timestamp', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup(fastGroup());
  await store.appendSourceEvent('g1', '101', now);
  await store.appendSourceEvent('g1', '101', now + 1);
  const saved = await store.getGroup('g1');
  assert.deepEqual(saved.sourceEventIds, ['100', '101']);
  assert.equal(saved.updatedAt, now + 1);
});

test('binds broker position/order identifiers to a leg without losing canonical state', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup(fastGroup());
  await store.bindLegExecution('g1', 'leg-1', { brokerPositionId: 'p99', brokerOrderId: 'o88', status: 'OPEN' }, now);
  const saved = await store.getGroup('g1');
  assert.equal(saved.legs[0].brokerPositionId, 'p99');
  assert.equal(saved.legs[0].brokerOrderId, 'o88');
  assert.equal(saved.symbol, 'XAUUSD');
});

test('closed groups are excluded from active correlation scans but remain auditable', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup(fastGroup());
  await store.setGroupStatus('g1', 'CLOSED', now);
  assert.equal((await store.listActive()).length, 0);
  assert.equal((await store.getGroup('g1')).status, 'CLOSED');
});

test('coordinator uses persisted groups to correlate full signal to prior fast entry', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup(fastGroup());
  const coordinator = new TradeStateCoordinator(store, { correlationWindowMs: 120000 });
  const result = await coordinator.correlate({
    source: { instance_id: 'listener-1' }, external_event_id: '101', thread: {},
  }, {
    status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false },
  }, now);
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g1' });
});

test('a fresh store and coordinator recover persisted correlation state after restart', async () => {
  const durableStorage = new MemoryStorage();
  const beforeRestart = new TradeStateStore(durableStorage);
  await beforeRestart.putGroup(fastGroup());

  const afterRestart = new TradeStateStore(durableStorage);
  const restartedCoordinator = new TradeStateCoordinator(afterRestart, { correlationWindowMs: 120000 });
  const result = await restartedCoordinator.correlate({
    workspace_hint: 'ws1',
    source: { instance_id: 'listener-1' },
    external_event_id: '101',
    thread: {},
  }, {
    status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false },
  }, now);

  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g1' });
  assert.deepEqual(await afterRestart.getGroup('g1'), fastGroup());
});

test('correlation never crosses an explicit workspace boundary even when listener identity matches', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup(fastGroup());
  const coordinator = new TradeStateCoordinator(store, { correlationWindowMs: 120000 });
  const result = await coordinator.correlate({
    workspace_hint: 'ws2',
    source: { instance_id: 'listener-1' },
    external_event_id: '101',
    thread: {},
  }, {
    status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false },
  }, now);
  assert.deepEqual(result, { status: 'NEW_GROUP' });
});

test('replayed signal event already bound to an active group is ignored before new-group planning', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup({ ...fastGroup(), incomplete: false });
  const coordinator = new TradeStateCoordinator(store, { correlationWindowMs: 120000 });
  const result = await coordinator.correlate({
    workspace_hint: 'ws1',
    source: { instance_id: 'listener-1' },
    external_event_id: '100',
    thread: {},
  }, {
    status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false },
  }, now);
  assert.deepEqual(result, { status: 'NO_ACTION', reason: 'DUPLICATE_SOURCE_EVENT' });
});

test('replayed management event already audited on the group emits no second management match', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup({ ...fastGroup(), sourceEventIds: ['100', 'manage-1'] });
  const coordinator = new TradeStateCoordinator(store, { correlationWindowMs: 120000 });
  const result = await coordinator.correlate({
    workspace_hint: 'ws1',
    source: { instance_id: 'listener-1' },
    external_event_id: 'manage-1',
    thread: {},
  }, {
    status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 },
  }, now);
  assert.deepEqual(result, { status: 'NO_ACTION', reason: 'DUPLICATE_SOURCE_EVENT' });
});
