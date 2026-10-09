import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SupabaseTradeStatePersistence,
  groupToPersistenceRows,
  persistenceRowsToGroup,
} from '../src/persistence/supabase_trade_state_persistence.js';

test('pending lifecycle scan selects only legs explicitly marked for lifecycle tracking', async () => {
  const calls = [];
  const row = {
    workspace_id: 'workspace-1', runtime_leg_id: 'old-pending-leg', broker_order_id: 'old-order',
    position_groups: { runtime_group_id: 'old-group', trade_account_id: 'account-1', canonical_symbol: 'EURUSD' },
  };
  const builder = {
    select(value) { calls.push(['select', value]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    not(...args) { calls.push(['not', ...args]); return this; },
    then(resolve) { return Promise.resolve({ data: [row], error: null }).then(resolve); },
  };
  const persistence = new SupabaseTradeStatePersistence({ from(table) { calls.push(['from', table]); return builder; } });
  await persistence.listPendingOrderLifecycles();
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'lifecycle_tracking_enabled' && call[2] === true));
});

const group = {
  id: 'evt-123:acc-456',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  tradeAccountId: '22222222-2222-4222-8222-222222222222',
  sourceEventId: '33333333-3333-4333-8333-333333333333',
  sourceInstanceId: 'telegram-primary',
  sourceEventIds: ['100', '101'],
  threadId: '77',
  symbol: 'XAUUSD',
  side: 'BUY',
  orderType: 'MARKET',
  entry: { kind: 'PRICE', value: 3500 },
  entryPrice: 3500,
  stopLoss: 3490,
  status: 'OPEN',
  incomplete: false,
  positionMode: 'HEDGED',
  riskPlan: { totalLots: 0.02 },
  policySnapshot: { allowed: true },
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  legs: [
    {
      legId: 'leg-1', targetIndex: 1, lots: 0.01, requestedLots: 0.01, executedLots: 0.01,
      stopLoss: 3490, takeProfit: 3510, status: 'OPEN', brokerPositionId: 'p-1',
      brokerOrderId: 'o-1', brokerDealId: 'd-1', fillPrice: 3500.5,
      volumeStepLots: 0.01, minimumLots: 0.01, actionType: 'OPEN_POSITION',
    },
    {
      legId: 'leg-2', targetIndex: 2, lots: 0.01, requestedLots: 0.01,
      stopLoss: 3490, takeProfit: 3520, status: 'PENDING', brokerOrderId: 'o-2',
      lifecycleTrackingEnabled: true,
    },
  ],
};

test('serializes composite runtime ids beside UUID relational keys and preserves broker lifecycle fields', () => {
  const rows = groupToPersistenceRows(group);
  assert.equal(rows.group.runtime_group_id, group.id);
  assert.equal(rows.group.workspace_id, group.workspaceId);
  assert.equal(rows.group.source_event_id, group.sourceEventId);
  assert.deepEqual(rows.group.source_event_ids, ['100', '101']);
  assert.equal(rows.legs[0].runtime_leg_id, 'leg-1');
  assert.equal(rows.legs[0].broker_position_id, 'p-1');
  assert.equal(rows.legs[0].broker_order_id, 'o-1');
  assert.equal(rows.legs[0].broker_deal_id, 'd-1');
  assert.equal(rows.legs[0].fill_price, 3500.5);
  assert.equal(rows.legs[0].requested_lots, 0.01);
  assert.equal(rows.legs[0].executed_lots, 0.01);
  assert.equal(rows.legs[0].remaining_lots, 0.01);
  assert.equal(rows.legs[1].lifecycle_tracking_enabled, true);
});

test('does not write a non-UUID external source id into the UUID source_event_id column', () => {
  const rows = groupToPersistenceRows({ ...group, sourceEventId: 'telegram:-1001822170589:25151' });
  assert.equal(rows.group.source_event_id, undefined);
  assert.equal(rows.group.runtime_group_id, group.id);
});

test('allows fully closed legs to persist with zero remaining lots', () => {
  const rows = groupToPersistenceRows({
    ...group,
    legs: [{ ...group.legs[0], lots: 0, status: 'CLOSED', actionType: 'CLOSE_POSITION' }],
  });
  assert.equal(rows.legs[0].lots, 0);
  assert.equal(rows.legs[0].remaining_lots, 0);
  assert.equal(rows.legs[0].requested_lots, 0.01);
});

test('hydrates relational rows back to canonical correlation and lifecycle state', () => {
  const rows = groupToPersistenceRows(group);
  const hydrated = persistenceRowsToGroup({
    ...rows.group,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    position_legs: rows.legs.map((row, index) => ({
      ...row,
      id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${index}`,
      position_group_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })),
  });

  assert.equal(hydrated.id, group.id);
  assert.equal(hydrated.workspaceId, group.workspaceId);
  assert.equal(hydrated.tradeAccountId, group.tradeAccountId);
  assert.deepEqual(hydrated.sourceEventIds, ['100', '101']);
  assert.equal(hydrated.threadId, '77');
  assert.equal(hydrated.entryPrice, 3500);
  assert.equal(hydrated.legs[0].legId, 'leg-1');
  assert.equal(hydrated.legs[0].brokerPositionId, 'p-1');
  assert.equal(hydrated.legs[0].brokerOrderId, 'o-1');
  assert.equal(hydrated.legs[0].brokerDealId, 'd-1');
  assert.equal(hydrated.legs[0].fillPrice, 3500.5);
  assert.equal(hydrated.legs[0].requestedLots, 0.01);
  assert.equal(hydrated.legs[0].executedLots, 0.01);
  assert.equal(hydrated.legs[1].lifecycleTrackingEnabled, true);
});

test('round trips lifecycle child identity and broker observation metadata while preserving legacy legs', () => {
  const lifecycleGroup = {
    ...group,
    legs: [
      { ...group.legs[0], lifecycleRole: 'PARENT', originatingOrderId: 'order-1', status: 'SUPERSEDED', logicalTargetIndex: 1, lastBrokerObservedAt: 1_700_000_001_000, lastBrokerSourceVersion: '42', lastBrokerStatus: 'PARTIALLY_FILLED', lastBrokerSnapshotFingerprint: 'stable-hash' },
      { legId: 'leg-1:fill:position-1', targetIndex: 3, logicalTargetIndex: 1, parentLegId: 'leg-1', lifecycleRole: 'FILLED_POSITION', originatingOrderId: 'order-1', brokerPositionId: 'position-1', brokerDealIds: ['deal-1', 'deal-2'], lots: 0.01, status: 'OPEN' },
      { ...group.legs[1], targetIndex: 2, lifecycleTrackingEnabled: false },
    ],
  };
  const rows = groupToPersistenceRows(lifecycleGroup);
  const hydrated = persistenceRowsToGroup({ ...rows.group, position_legs: rows.legs });

  assert.equal(rows.legs[0].lifecycle_role, 'PARENT');
  assert.equal(rows.legs[1].parent_leg_id, 'leg-1');
  assert.equal(rows.legs[1].logical_target_index, 1);
  assert.deepEqual(rows.legs[1].broker_deal_ids, ['deal-1', 'deal-2']);
  assert.equal(hydrated.legs[0].lastBrokerObservedAt, 1_700_000_001_000);
  assert.equal(hydrated.legs[0].lastBrokerSnapshotFingerprint, 'stable-hash');
  const hydratedChild = hydrated.legs.find((leg) => leg.legId === 'leg-1:fill:position-1');
  const hydratedLegacy = hydrated.legs.find((leg) => leg.legId === 'leg-2');
  assert.equal(hydratedChild.lifecycleRole, 'FILLED_POSITION');
  assert.deepEqual(hydratedChild.brokerDealIds, ['deal-1', 'deal-2']);
  assert.equal(hydratedLegacy.lifecycleRole, null);
  assert.equal(hydratedLegacy.logicalTargetIndex, undefined);
  assert.equal(hydratedLegacy.lifecycleTrackingEnabled, false);
});
