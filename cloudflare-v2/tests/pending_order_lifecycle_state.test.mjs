import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeStateStore } from '../src/state/trade_state_store.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async list({ prefix = '' } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(prefix))); }
}

class MemoryPersistence {
  constructor() { this.groups = new Map(); }
  async saveGroup(group) { this.groups.set(String(group.id), structuredClone(group)); return group; }
  async loadGroup(workspaceId, groupId) {
    const group = this.groups.get(String(groupId));
    return group && String(group.workspaceId) === String(workspaceId) ? structuredClone(group) : null;
  }
  async loadActive(workspaceId) {
    return [...this.groups.values()].filter((group) => String(group.workspaceId) === String(workspaceId)).map((group) => structuredClone(group));
  }
}

const pendingGroup = () => ({
  id: 'group-1', workspaceId: 'workspace-1', tradeAccountId: 'account-row-1',
  symbol: 'EURUSD', side: 'BUY', orderType: 'LIMIT', status: 'PENDING',
  createdAt: 100, updatedAt: 100,
  legs: [{
    legId: 'logical-leg-1', targetIndex: 1, lots: 0.10, requestedLots: 0.10,
    status: 'PENDING', brokerOrderId: 'broker-order-1', brokerPositionId: null, lifecycleTrackingEnabled: true,
  }],
});

const snapshotArgs = (overrides = {}) => ({
  tradeAccountId: 'account-row-1',
  brokerOrderId: 'broker-order-1',
  nowMs: 200,
  snapshot: {
    status: 'PARTIALLY_FILLED',
    remainingLots: 0.06,
    fills: [{ dealId: 'deal-1', positionId: 'position-1', lots: 0.04, fillPrice: 1.0825 }],
    observedAt: 190,
    sourceVersion: 'version-1',
  },
  ...overrides,
});

function makeStore({ persistence = null, storage = new MemoryStorage() } = {}) {
  const store = new TradeStateStore(storage, { persistence, workspaceId: 'workspace-1' });
  return { store, storage };
}

test('partial fill creates one exact open position child and one pending remainder child', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());

  const result = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs());

  assert.equal(result.outcome, 'APPLIED');
  assert.equal(result.group.status, 'OPEN');
  const parent = result.group.legs.find((leg) => leg.legId === 'logical-leg-1');
  assert.equal(parent.status, 'SUPERSEDED');
  assert.equal(parent.lifecycleRole, 'PARENT');
  assert.equal(parent.brokerOrderId, undefined);
  const filled = result.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION');
  assert.deepEqual({
    status: filled.status, lots: filled.lots, brokerPositionId: filled.brokerPositionId,
    brokerDealId: filled.brokerDealId, fillPrice: filled.fillPrice, parentLegId: filled.parentLegId,
  }, {
    status: 'OPEN', lots: 0.04, brokerPositionId: 'position-1',
    brokerDealId: 'deal-1', fillPrice: 1.0825, parentLegId: 'logical-leg-1',
  });
  const remainder = result.group.legs.find((leg) => leg.lifecycleRole === 'PENDING_REMAINDER');
  assert.deepEqual({ status: remainder.status, lots: remainder.lots, brokerOrderId: remainder.brokerOrderId }, {
    status: 'PENDING', lots: 0.06, brokerOrderId: 'broker-order-1',
  });
  assert.equal(parent.lifecycleTrackingEnabled, true);
  assert.equal(filled.lifecycleTrackingEnabled, true);
  assert.equal(remainder.lifecycleTrackingEnabled, true);
});

test('unmarked legacy pending trades cannot be reconciled', async () => {
  const { store } = makeStore();
  await store.putGroup({ ...pendingGroup(), legs: [{ ...pendingGroup().legs[0], lifecycleTrackingEnabled: false }] });
  const result = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs());
  assert.equal(result.outcome, 'MISMATCH');
  assert.equal(result.group.legs.length, 1);
  assert.equal(result.group.legs[0].status, 'PENDING');
});

test('partial activation preserves per-TP fixed lots and leaves sibling TP orders unchanged', async () => {
  const group = {
    ...pendingGroup(),
    legs: [1, 2, 3].map((targetIndex) => ({
      legId: `logical-leg-${targetIndex}`,
      targetIndex,
      lots: 0.10,
      requestedLots: 0.10,
      takeProfit: 1.09 - targetIndex * 0.001,
      status: 'PENDING',
      brokerOrderId: `broker-order-${targetIndex}`,
      lifecycleTrackingEnabled: true,
    })),
  };
  const { store } = makeStore();
  await store.putGroup(group);

  const result = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-2', {
    tradeAccountId: 'account-row-1',
    brokerOrderId: 'broker-order-2',
    snapshot: {
      status: 'PARTIALLY_FILLED',
      requestedLots: 0.10,
      remainingLots: 0.06,
      fills: [{ dealId: 'deal-2a', positionId: 'position-2a', lots: 0.04, fillPrice: 1.0825 }],
      observedAt: 190,
      sourceVersion: 'version-1',
    },
  });

  assert.equal(result.outcome, 'APPLIED');
  const originalLegs = ['logical-leg-1', 'logical-leg-2', 'logical-leg-3']
    .map((legId) => result.group.legs.find((leg) => leg.legId === legId));
  assert.deepEqual(originalLegs.map((leg) => [leg.legId, leg.status, leg.requestedLots]), [
    ['logical-leg-1', 'PENDING', 0.10],
    ['logical-leg-2', 'SUPERSEDED', 0.10],
    ['logical-leg-3', 'PENDING', 0.10],
  ]);
  const fill = result.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION');
  const remainder = result.group.legs.find((leg) => leg.lifecycleRole === 'PENDING_REMAINDER');
  assert.deepEqual([fill.logicalTargetIndex, fill.requestedLots, fill.lots, fill.takeProfit], [2, 0.04, 0.04, 1.088]);
  assert.deepEqual([remainder.logicalTargetIndex, remainder.requestedLots, remainder.lots, remainder.brokerOrderId], [2, 0.06, 0.06, 'broker-order-2']);
});

test('a cBot fill with exact position identity does not invent a broker deal id', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  const result = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({
    snapshot: { status: 'PARTIALLY_FILLED', remainingLots: 0.06,
      fills: [{ positionId: 'position-1', lots: 0.04, fillPrice: 1.0825 }], observedAt: 190 },
  }));
  const fill = result.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION');
  assert.equal(result.outcome, 'APPLIED');
  assert.equal(fill.brokerDealId, undefined);
  assert.deepEqual(fill.brokerDealIds, []);
});

test('duplicate cumulative snapshot is idempotent and does not add child legs', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  const first = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs());
  const second = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({ nowMs: 201 }));

  assert.equal(first.outcome, 'APPLIED');
  assert.equal(second.outcome, 'UNCHANGED');
  assert.equal(second.group.legs.length, 3);
  assert.equal(second.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION').lots, 0.04);
});

test('a later partial observation on the remainder updates the original position children', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  const first = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs());
  const second = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1:remainder', snapshotArgs({
    nowMs: 205,
    snapshot: { status: 'PARTIALLY_FILLED', remainingLots: 0.04, fills: [
      { dealId: 'deal-1', positionId: 'position-1', lots: 0.04, fillPrice: 1.0825 },
      { dealId: 'deal-2', positionId: 'position-2', lots: 0.02, fillPrice: 1.0830 },
    ], observedAt: 204, sourceVersion: 'version-2' },
  }));

  assert.equal(first.outcome, 'APPLIED');
  assert.equal(second.outcome, 'APPLIED');
  assert.equal(second.group.legs.filter((leg) => leg.lifecycleRole === 'FILLED_POSITION').length, 2);
  assert.equal(second.group.legs.find((leg) => leg.legId === 'logical-leg-1:fill:position-1').lots, 0.04);
  assert.equal(second.group.legs.find((leg) => leg.legId === 'logical-leg-1:fill:position-2').lots, 0.02);
  assert.equal(second.group.legs.find((leg) => leg.legId === 'logical-leg-1:remainder').lots, 0.04);
});

test('older broker snapshot cannot regress a later partial fill', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs());
  const older = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({
    nowMs: 202,
    snapshot: { status: 'PENDING', remainingLots: 0.10, fills: [], observedAt: 180, sourceVersion: 'older' },
  }));

  assert.equal(older.outcome, 'STALE');
  assert.equal(older.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION').lots, 0.04);
  assert.equal(older.group.legs.find((leg) => leg.lifecycleRole === 'PENDING_REMAINDER').lots, 0.06);
});

test('wrong account or broker order identity is rejected without mutation', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  const accountMismatch = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({ tradeAccountId: 'other-account' }));
  const orderMismatch = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({ brokerOrderId: 'other-order' }));

  assert.equal(accountMismatch.outcome, 'MISMATCH');
  assert.equal(orderMismatch.outcome, 'MISMATCH');
  assert.deepEqual((await store.getGroup('group-1')).legs, pendingGroup().legs);
});

test('broker cancellation terminalizes only the remainder and preserves filled positions', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs());
  const cancelled = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({
    nowMs: 205,
    snapshot: { status: 'CANCELLED', remainingLots: 0, fills: [{ dealId: 'deal-1', positionId: 'position-1', lots: 0.04, fillPrice: 1.0825 }], observedAt: 204, sourceVersion: 'version-2' },
  }));

  assert.equal(cancelled.outcome, 'APPLIED');
  assert.equal(cancelled.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION').status, 'OPEN');
  assert.equal(cancelled.group.legs.find((leg) => leg.lifecycleRole === 'PENDING_REMAINDER').status, 'CANCELLED');
  assert.equal(cancelled.group.legs.find((leg) => leg.lifecycleRole === 'PENDING_REMAINDER').lots, 0);
});

test('full fill creates filled child without an actionable pending remainder', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  const result = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({
    snapshot: { status: 'FILLED', remainingLots: 0, fills: [{ dealId: 'deal-1', positionId: 'position-1', lots: 0.10, fillPrice: 1.0825 }], observedAt: 190, sourceVersion: 'version-1' },
  }));

  assert.equal(result.outcome, 'APPLIED');
  assert.equal(result.group.legs.filter((leg) => leg.lifecycleRole === 'PENDING_REMAINDER' && leg.status === 'PENDING').length, 0);
  assert.equal(result.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION').lots, 0.10);
});

test('cancelling an entirely unfilled order closes the pending group without creating a position', async () => {
  const { store } = makeStore();
  await store.putGroup(pendingGroup());
  const result = await store.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({
    snapshot: { status: 'CANCELLED', remainingLots: 0, fills: [], observedAt: 190, sourceVersion: 'version-1' },
  }));

  assert.equal(result.outcome, 'APPLIED');
  assert.equal(result.group.status, 'CLOSED');
  assert.equal(result.group.legs.filter((leg) => leg.lifecycleRole === 'FILLED_POSITION').length, 0);
  assert.equal(result.group.legs.filter((leg) => leg.lifecycleRole === 'PENDING_REMAINDER').length, 0);
});

test('snapshot transition survives persistence reload without duplicating fills', async () => {
  const persistence = new MemoryPersistence();
  const firstStore = makeStore({ persistence }).store;
  await firstStore.putGroup(pendingGroup());
  await firstStore.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs());

  const afterRestart = makeStore({ persistence }).store;
  const replay = await afterRestart.reconcilePendingOrderSnapshot('group-1', 'logical-leg-1', snapshotArgs({ nowMs: 205 }));
  assert.equal(replay.outcome, 'UNCHANGED');
  assert.equal(replay.group.legs.filter((leg) => leg.lifecycleRole === 'FILLED_POSITION').length, 1);
  assert.equal(replay.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION').lots, 0.04);
});
