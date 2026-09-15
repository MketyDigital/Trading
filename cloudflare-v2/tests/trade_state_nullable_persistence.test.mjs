import test from 'node:test';
import assert from 'node:assert/strict';

import {
  groupToPersistenceRows,
  persistenceRowsToGroup,
} from '../src/persistence/supabase_trade_state_persistence.js';

const baseGroup = {
  id: 'group-nullable',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  tradeAccountId: '22222222-2222-4222-8222-222222222222',
  symbol: 'XAUUSD',
  side: 'BUY',
  orderType: 'MARKET',
  entry: { kind: 'MARKET' },
  status: 'PLANNED',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
  legs: [{
    legId: 'leg-nullable',
    targetIndex: 1,
    lots: 0,
    requestedLots: null,
    executedLots: null,
    fillPrice: null,
    volumeStepLots: null,
    minimumLots: null,
    stopLoss: null,
    takeProfit: null,
    status: 'PLANNED',
  }],
};

test('nullable numeric leg fields remain null at the persistence write boundary while zero remains valid', () => {
  const rows = groupToPersistenceRows(baseGroup);
  const leg = rows.legs[0];
  assert.equal(leg.requested_lots, null);
  assert.equal(leg.executed_lots, null);
  assert.equal(leg.fill_price, null);
  assert.equal(leg.volume_step_lots, null);
  assert.equal(leg.minimum_lots, null);
  assert.equal(leg.lots, 0);
  assert.equal(leg.remaining_lots, 0);

  const zeroRows = groupToPersistenceRows({
    ...baseGroup,
    legs: [{
      ...baseGroup.legs[0],
      requestedLots: 0,
      executedLots: 0,
      fillPrice: 0,
      volumeStepLots: 0,
      minimumLots: 0,
    }],
  });
  assert.equal(zeroRows.legs[0].requested_lots, 0);
  assert.equal(zeroRows.legs[0].executed_lots, 0);
  assert.equal(zeroRows.legs[0].fill_price, 0);
  assert.equal(zeroRows.legs[0].volume_step_lots, 0);
  assert.equal(zeroRows.legs[0].minimum_lots, 0);
});

test('database null numeric fields hydrate as null instead of becoming zero', () => {
  const rows = groupToPersistenceRows(baseGroup);
  const hydrated = persistenceRowsToGroup({
    ...rows.group,
    position_legs: [{
      ...rows.legs[0],
      requested_lots: null,
      executed_lots: null,
      fill_price: null,
      volume_step_lots: null,
      minimum_lots: null,
    }],
  });

  assert.equal(hydrated.legs[0].requestedLots, null);
  assert.equal(hydrated.legs[0].executedLots, null);
  assert.equal(hydrated.legs[0].fillPrice, null);
  assert.equal(hydrated.legs[0].volumeStepLots, null);
  assert.equal(hydrated.legs[0].minimumLots, null);
});
