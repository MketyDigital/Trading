import test from 'node:test';
import assert from 'node:assert/strict';

import { TradeStateStore } from '../src/state/trade_state_store.js';
import { groupToPersistenceRows, persistenceRowsToGroup } from '../src/persistence/supabase_trade_state_persistence.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async list({ prefix = '' } = {}) { return new Map([...this.values].filter(([key]) => key.startsWith(prefix))); }
}

test('successful OPEN stamps openedAt and persistence/recovery preserves it', async () => {
  const nowMs = 1_789_474_800_000;
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup({
    id: 'group-opened-at', workspaceId: '11111111-1111-4111-8111-111111111111',
    tradeAccountId: '22222222-2222-4222-8222-222222222222', symbol: 'XAUUSD', side: 'BUY',
    orderType: 'MARKET', entry: { kind: 'MARKET' }, status: 'PLANNED', sourceEventIds: ['telegram:-1001:1'],
    createdAt: nowMs - 1000, updatedAt: nowMs - 1000,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.01, status: 'PLANNED' }],
  });

  const opened = await store.bindLegExecution('group-opened-at', 'leg-1', {
    actionType: 'OPEN_POSITION', status: 'OPEN', brokerPositionId: 'position-1', brokerOrderId: 'order-1',
    brokerDealId: 'deal-1', fillPrice: 4306.45, executedLots: 0.01,
  }, nowMs);

  assert.equal(opened.legs[0].openedAt, nowMs);
  const rows = groupToPersistenceRows(opened);
  assert.equal(rows.legs[0].opened_at, new Date(nowMs).toISOString());

  const hydrated = persistenceRowsToGroup({
    ...rows.group,
    runtime_group_id: opened.id,
    position_legs: [{ ...rows.legs[0], runtime_leg_id: 'leg-1' }],
  });
  assert.equal(hydrated.legs[0].openedAt, nowMs);
  assert.equal(hydrated.legs[0].fillPrice, 4306.45);
  assert.equal(hydrated.legs[0].brokerPositionId, 'position-1');
});
