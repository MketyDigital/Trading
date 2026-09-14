import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';
import { TradeStateStore } from '../src/state/trade_state_store.js';
import { groupToPersistenceRows, persistenceRowsToGroup } from '../src/persistence/supabase_trade_state_persistence.js';

const now = 1700000000000;

function group(overrides = {}) {
  return {
    id: 'g1',
    workspaceId: 'ws1',
    tradeAccountId: 'acct-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['telegram:-1001:283'],
    threadId: null,
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entry: { kind: 'MARKET' },
    entryPrice: 4306.45,
    status: 'OPEN',
    incomplete: true,
    createdAt: now - 10 * 60 * 1000,
    updatedAt: now - 5 * 60 * 1000,
    legs: [{
      legId: 'leg-1', targetIndex: 1, lots: 0.01, status: 'OPEN',
      brokerPositionId: 'position-open', brokerOrderId: 'order-open', brokerDealId: 'deal-open',
      fillPrice: 4306.45, executedLots: 0.01,
    }],
    ...overrides,
  };
}

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async list({ prefix = '' } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(prefix))); }
}

test('adjacent Telegram management message can target the immediately preceding logical trade even outside the time window', () => {
  const result = correlateTradingEvent({
    event: {
      workspace_hint: 'ws1',
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:284',
      thread: {},
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } },
    activeGroups: [
      group({ id: 'ctrader', tradeAccountId: 'ctrader' }),
      group({ id: 'mt5', tradeAccountId: 'mt5' }),
      group({ id: 'old', tradeAccountId: 'old', sourceEventIds: ['telegram:-1001:250'], symbol: 'EURUSD', updatedAt: now - 60 * 60 * 1000 }),
    ],
    nowMs: now,
    correlationWindowMs: 120000,
  });

  assert.deepEqual(result, {
    status: 'MATCHED',
    reason: 'SOURCE_MESSAGE_CONTINUITY',
    groupIds: ['ctrader', 'mt5'],
  });
});

test('source-message continuity chooses a newer intervening trade instead of an older same-source trade', () => {
  const result = correlateTradingEvent({
    event: {
      workspace_hint: 'ws1',
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:289',
      thread: {},
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [
      group({ id: 'gold-old', sourceEventIds: ['telegram:-1001:283'], symbol: 'XAUUSD' }),
      group({ id: 'gbp-new', sourceEventIds: ['telegram:-1001:288'], symbol: 'GBPUSD', side: 'BUY', updatedAt: now - 20 * 1000 }),
    ],
    nowMs: now,
    correlationWindowMs: 120000,
  });

  assert.deepEqual(result, { status: 'MATCHED', reason: 'SOURCE_MESSAGE_CONTINUITY', groupId: 'gbp-new' });
});

test('source-message continuity remains fail-closed when the nearest trade is too far back in Telegram message sequence', () => {
  const result = correlateTradingEvent({
    event: {
      workspace_hint: 'ws1',
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:320',
      thread: {},
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [group({ sourceEventIds: ['telegram:-1001:283'] })],
    nowMs: now,
    correlationWindowMs: 120000,
  });

  assert.deepEqual(result, { status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: 'g1' });
});

test('open fill establishes durable market entry price and close preserves original broker identity and fill', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  const initial = group({
    entryPrice: undefined,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.01, status: 'PLANNED' }],
  });
  await store.putGroup(initial);

  await store.bindLegExecution('g1', 'leg-1', {
    actionType: 'OPEN_POSITION',
    status: 'OPEN',
    brokerPositionId: 'position-open',
    brokerOrderId: 'order-open',
    brokerDealId: 'deal-open',
    fillPrice: 4306.45,
    executedLots: 0.01,
  }, now - 1000);

  const opened = await store.getGroup('g1');
  assert.equal(opened.entryPrice, 4306.45);
  assert.equal(opened.legs[0].fillPrice, 4306.45);

  await store.bindLegExecution('g1', 'leg-1', {
    actionType: 'CLOSE_POSITION',
    status: 'CLOSED',
    brokerPositionId: 'closing-ticket',
    brokerOrderId: 'closing-order',
    brokerDealId: 'closing-deal',
    fillPrice: 4307.25,
    executedLots: 0.01,
  }, now);

  const closed = await store.getGroup('g1');
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.legs[0].status, 'CLOSED');
  assert.equal(closed.legs[0].lots, 0);
  assert.equal(closed.legs[0].brokerPositionId, 'position-open');
  assert.equal(closed.legs[0].brokerOrderId, 'order-open');
  assert.equal(closed.legs[0].brokerDealId, 'deal-open');
  assert.equal(closed.legs[0].fillPrice, 4306.45);
  assert.equal(closed.legs[0].closedAt, now);
});

test('market execution entry price survives Supabase persistence and recovery', () => {
  const original = group({ entryPrice: 4306.45 });
  const rows = groupToPersistenceRows(original);
  assert.equal(rows.group.entry.executedPrice, 4306.45);

  const hydrated = persistenceRowsToGroup({
    id: 'db-group',
    ...rows.group,
    position_legs: rows.legs.map((leg, index) => ({
      id: `db-leg-${index + 1}`,
      position_group_id: 'db-group',
      ...leg,
      created_at: new Date(now - 10 * 60 * 1000).toISOString(),
    })),
  });

  assert.equal(hydrated.entryPrice, 4306.45);
});
