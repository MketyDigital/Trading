import test from 'node:test';
import assert from 'node:assert/strict';

import {
  durablePositionGroupRow,
  durablePositionLegRow,
} from '../src/persistence/supabase_trade_state_materializer.js';
import { TradeStateStore } from '../src/state/trade_state_store.js';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function group(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId,
    tradeAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sourceEventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entry: { kind: 'MARKET' },
    stopLoss: null,
    status: 'PLANNED',
    createdAt: 1789389000000,
    updatedAt: 1789389000000,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.01, stopLoss: null, takeProfit: null, status: 'PLANNED' }],
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async list({ prefix } = {}) {
      return new Map([...values].filter(([key]) => String(key).startsWith(prefix || '')));
    },
  };
}

test('durable mapping preserves absent numeric protection fields as null', () => {
  const state = group();
  const durableGroup = durablePositionGroupRow(state, workspaceId);
  const durableLeg = durablePositionLegRow(state, state.legs[0], workspaceId);

  assert.equal(durableGroup.stop_loss, null);
  assert.equal(durableLeg.stop_loss, null);
  assert.equal(durableLeg.take_profit, null);
});

test('modify does not rewrite opened_at and close persists zero remaining lots', () => {
  const modified = group({
    status: 'OPEN',
    updatedAt: 1789389060000,
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0.05,
      requestedLots: 0.01,
      status: 'OPEN',
      actionType: 'MODIFY_POSITION',
      executedLots: 0.05,
    }],
  });
  const modifyRow = durablePositionLegRow(modified, modified.legs[0], workspaceId);
  assert.equal(Object.hasOwn(modifyRow, 'opened_at'), false);
  assert.equal(modifyRow.requested_lots, 0.01);
  assert.equal(modifyRow.remaining_lots, 0.05);

  const closed = group({
    status: 'CLOSED',
    updatedAt: 1789389120000,
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0,
      requestedLots: 0.01,
      status: 'CLOSED',
      actionType: 'CLOSE_POSITION',
      executedLots: 0.05,
    }],
  });
  const closeRow = durablePositionLegRow(closed, closed.legs[0], workspaceId);
  assert.equal(closeRow.lots, 0);
  assert.equal(closeRow.remaining_lots, 0);
  assert.equal(closeRow.requested_lots, 0.01);
  assert.match(closeRow.closed_at, /^2026-/);
});

test('canonical state preserves requested lot size across broker normalization and close', async () => {
  const store = new TradeStateStore(memoryStorage());
  await store.putGroup(group());

  const opened = await store.bindLegExecution(
    '11111111-1111-4111-8111-111111111111',
    'leg-1',
    {
      actionType: 'OPEN_POSITION',
      brokerPositionId: 'position-1',
      executedLots: 0.05,
    },
    1789389060000,
  );
  assert.equal(opened.legs[0].requestedLots, 0.01);
  assert.equal(opened.legs[0].lots, 0.05);

  const closed = await store.bindLegExecution(
    opened.id,
    'leg-1',
    { actionType: 'CLOSE_POSITION', executedLots: 0.05 },
    1789389120000,
  );
  assert.equal(closed.legs[0].requestedLots, 0.01);
  assert.equal(closed.legs[0].lots, 0);
  assert.equal(closed.legs[0].status, 'CLOSED');
});
