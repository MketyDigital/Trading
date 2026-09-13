import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTradingEvent } from '../src/events/trading_event.js';
import { TradeStateStore } from '../src/state/trade_state_store.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async list({ prefix = '' } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(prefix))); }
}

test('canonicalizes nested Telegram reply_to_message_id using the source chat identity', () => {
  const result = normalizeTradingEvent({
    source: { type: 'telegram_mtproto', instance_id: 'listener-1', external_id: '-1003902892609' },
    external_event_id: 'telegram:-1003902892609:241',
    text: 'close',
    thread: { reply_to_message_id: 238 },
    metadata: { native_identity: { chat_id: '-1003902892609', message_id: '241' } },
  }, { requireIdentity: true });

  assert.equal(result.ok, true);
  assert.equal(result.event.thread.reply_to_event_id, 'telegram:-1003902892609:238');
});

test('preserves an already canonical Telegram reply event id', () => {
  const result = normalizeTradingEvent({
    source: { type: 'telegram_mtproto', instance_id: 'listener-1', external_id: '-1001' },
    external_event_id: 'telegram:-1001:10',
    text: 'BE',
    thread: { reply_to_event_id: 'telegram:-1001:9' },
  }, { requireIdentity: true });
  assert.equal(result.event.thread.reply_to_event_id, 'telegram:-1001:9');
});

test('broker position binding promotes a planned leg and group to OPEN automatically', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup({
    id: 'g1', status: 'PLANNED', symbol: 'BTCUSD',
    legs: [{ legId: 'leg-1', status: 'PLANNED', lots: 0.01 }],
  });

  await store.bindLegExecution('g1', 'leg-1', {
    brokerPositionId: 'p1', brokerOrderId: 'o1', fillPrice: 77000,
  }, 1000);

  const saved = await store.getGroup('g1');
  assert.equal(saved.legs[0].status, 'OPEN');
  assert.equal(saved.status, 'OPEN');
});

test('pending-order binding promotes planned leg and group to PENDING', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup({
    id: 'g2', status: 'PLANNED', symbol: 'EURUSD',
    legs: [{ legId: 'leg-1', status: 'PLANNED', lots: 0.01 }],
  });

  await store.bindLegExecution('g2', 'leg-1', { brokerOrderId: 'o2' }, 1000);
  const saved = await store.getGroup('g2');
  assert.equal(saved.legs[0].status, 'PENDING');
  assert.equal(saved.status, 'PENDING');
});

test('terminal entry failure makes an otherwise phantom planned group inactive', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup({
    id: 'g3', status: 'PLANNED', symbol: 'DERIV:VOLATILITY_75_1S',
    legs: [{ legId: 'leg-1', status: 'PLANNED', lots: 0.01 }],
  });

  await store.bindLegExecution('g3', 'leg-1', { status: 'FAILED', failureCode: 'CTRADER_VOLUME_BELOW_MINIMUM' }, 1000);
  const saved = await store.getGroup('g3');
  assert.equal(saved.legs[0].status, 'FAILED');
  assert.equal(saved.status, 'FAILED');
  assert.deepEqual(await store.listActive(), []);
});
