import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupToPersistenceRows,
  persistenceRowsToGroup,
} from '../src/persistence/supabase_trade_state_persistence.js';

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
      legId: 'leg-1', targetIndex: 1, lots: 0.01, stopLoss: 3490, takeProfit: 3510,
      status: 'OPEN', brokerPositionId: 'p-1', brokerOrderId: 'o-1', fillPrice: 3500.5,
      volumeStepLots: 0.01, minimumLots: 0.01,
    },
    {
      legId: 'leg-2', targetIndex: 2, lots: 0.01, stopLoss: 3490, takeProfit: 3520,
      status: 'PENDING', brokerOrderId: 'o-2',
    },
  ],
};

test('serializes DO group state to relational group and leg rows without requiring text state key to be a UUID', () => {
  const rows = groupToPersistenceRows(group);
  assert.equal(rows.group.state_key, group.id);
  assert.equal(rows.group.workspace_id, group.workspaceId);
  assert.equal(rows.group.canonical_symbol, 'XAUUSD');
  assert.deepEqual(rows.group.source_event_ids, ['100', '101']);
  assert.equal(rows.legs[0].leg_key, 'leg-1');
  assert.equal(rows.legs[0].broker_position_id, 'p-1');
  assert.equal(rows.legs[0].broker_order_id, 'o-1');
  assert.equal(rows.legs[0].metadata.fillPrice, 3500.5);
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
  assert.equal(hydrated.legs[0].fillPrice, 3500.5);
});
