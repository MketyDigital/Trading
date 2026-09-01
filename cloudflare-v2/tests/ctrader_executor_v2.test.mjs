import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCTraderAction } from '../src/adapters/ctrader_executor_v2.js';

const symbol = {
  platform: 'ctrader', platformId: 41, platformSymbol: 'XAU/USD', canonical: 'XAUUSD', aliases: ['GOLD'],
  digits: 2, tickSize: 0.01, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000000, stepVolume: 100,
};

function deliveryStore({ duplicate = false } = {}) {
  const completed = [];
  return {
    completed,
    reserve: async (key) => duplicate ? { ok: false, duplicate: true, result: { brokerPositionId: 999 } } : { ok: true, id: `delivery:${key}` },
    complete: async (key, result) => completed.push({ key, result }),
    fail: async () => {},
  };
}

test('cTrader market open waits for position id then applies absolute SL/TP by amend request', async () => {
  const sent = [];
  const session = {
    request: async (message) => {
      sent.push(message);
      if (message.payloadType === 2106) return { payloadType: 2126, payload: { position: { positionId: 456 }, order: { orderId: 1001 } } };
      if (message.payloadType === 2110) return { payloadType: 2126, payload: { position: { positionId: 456, stopLoss: 2518, takeProfit: 2535 } } };
      throw new Error('unexpected request');
    },
  };
  const store = deliveryStore();
  const result = await executeCTraderAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', entry: { kind: 'MARKET' },
    lots: 0.03, stopLoss: 2518, takeProfit: 2535, idempotencyKey: 'evt1-acct1-leg1',
  }, { session, accountId: 77, catalog: [symbol], deliveryStore: store });

  assert.equal(sent[0].payloadType, 2106);
  assert.equal(sent[0].payload.stopLoss, undefined);
  assert.equal(sent[0].payload.clientOrderId, 'evt1-acct1-leg1');
  assert.equal(sent[1].payloadType, 2110);
  assert.equal(sent[1].payload.positionId, 456);
  assert.equal(result.brokerPositionId, 456);
  assert.equal(result.brokerOrderId, 1001);
  assert.equal(store.completed.length, 1);
});

test('cTrader pending order sends protection with initial order and does not amend a non-position', async () => {
  const sent = [];
  const session = {
    request: async (message) => {
      sent.push(message);
      return { payloadType: 2126, payload: { order: { orderId: 2002 } } };
    },
  };
  const result = await executeCTraderAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'LIMIT', symbol: 'XAUUSD', entry: { kind: 'PRICE', value: 2520 },
    lots: 0.03, stopLoss: 2510, takeProfit: 2540, idempotencyKey: 'evt2-acct1-leg1',
  }, { session, accountId: 77, catalog: [symbol], deliveryStore: deliveryStore() });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.limitPrice, 2520);
  assert.equal(sent[0].payload.stopLoss, 2510);
  assert.equal(sent[0].payload.takeProfit, 2540);
  assert.equal(result.brokerOrderId, 2002);
});

test('duplicate persistent delivery reservation returns previous result without sending broker request', async () => {
  let called = false;
  const result = await executeCTraderAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', entry: { kind: 'MARKET' }, lots: 0.03,
    idempotencyKey: 'already-done',
  }, {
    session: { request: async () => { called = true; } }, accountId: 77, catalog: [symbol], deliveryStore: deliveryStore({ duplicate: true }),
  });
  assert.equal(result.duplicate, true);
  assert.equal(called, false);
});

test('executes canonical cTrader partial close through same idempotent service', async () => {
  let sent;
  const result = await executeCTraderAction({
    type: 'CLOSE_PARTIAL', brokerPositionId: 456, lots: 0.03, symbol: 'XAUUSD', idempotencyKey: 'close-tp1',
  }, {
    session: { request: async (message) => { sent = message; return { payloadType: 2126, payload: { position: { positionId: 456 } } }; } },
    accountId: 77, catalog: [symbol], deliveryStore: deliveryStore(),
  });
  assert.equal(sent.payloadType, 2111);
  assert.equal(sent.payload.positionId, 456);
  assert.equal(result.brokerPositionId, 456);
});
