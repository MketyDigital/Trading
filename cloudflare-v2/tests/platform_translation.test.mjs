import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMT5OrderCommand, buildCTraderOrderCommand } from '../src/execution/platform_translation.js';

const action = {
  type: 'OPEN_POSITION',
  side: 'BUY',
  orderType: 'LIMIT',
  entry: { kind: 'PRICE', value: 2526.237 },
  lots: 0.03,
  stopLoss: 2518.004,
  takeProfit: 2535.008,
};

test('translates canonical action to broker-specific MT5 command', () => {
  const translated = buildMT5OrderCommand(action, {
    platformSymbol: 'XAUUSD.a',
    digits: 2,
    tickSize: 0.01,
    minLots: 0.01,
    maxLots: 50,
    stepLots: 0.01,
  });

  assert.deepEqual(translated, {
    type: 'OPEN_POSITION',
    symbol: 'XAUUSD.a',
    side: 'BUY',
    orderType: 'LIMIT',
    volume: 0.03,
    entryPrice: 2526.24,
    stopLoss: 2518,
    takeProfit: 2535.01,
  });
});

test('translates the same canonical pending action to cTrader protocol semantics', () => {
  const translated = buildCTraderOrderCommand({ ...action, idempotencyKey: 'evt-account-leg1' }, {
    accountId: 77,
    clientMsgId: 'abc',
    symbol: {
      platformId: 41,
      platformSymbol: 'XAU/USD',
      digits: 2,
      tickSize: 0.01,
      protocolLotSize: 10000,
      minVolume: 100,
      stepVolume: 100,
    },
  });

  assert.equal(translated.payload.symbolId, 41);
  assert.equal(translated.payload.volume, 300);
  assert.equal(translated.payload.limitPrice, 2526.24);
  assert.equal(translated.payload.stopLoss, 2518);
  assert.equal(translated.payload.takeProfit, 2535.01);
  assert.equal(translated.payload.clientOrderId, 'evt-account-leg1');
});

test('cTrader MARKET request omits absolute protection until position id is returned', () => {
  const translated = buildCTraderOrderCommand({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', entry: { kind: 'MARKET' }, lots: 0.03,
    stopLoss: 2518, takeProfit: 2535, idempotencyKey: 'market-leg-1',
  }, {
    accountId: 77, clientMsgId: 'market-1',
    symbol: { platformId: 41, digits: 2, tickSize: 0.01, protocolLotSize: 10000, minVolume: 100, stepVolume: 100 },
  });
  assert.equal(translated.payload.orderType, 1);
  assert.equal(translated.payload.stopLoss, undefined);
  assert.equal(translated.payload.takeProfit, undefined);
  assert.equal(translated.payload.clientOrderId, 'market-leg-1');
});
