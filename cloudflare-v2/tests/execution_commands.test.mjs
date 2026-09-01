import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAmendPositionSLTPMessage,
  buildClosePositionMessage,
  buildCancelOrderMessage,
} from '../src/adapters/ctrader_protocol.js';
import {
  buildMT5ManagementCommand,
  buildCTraderManagementCommand,
} from '../src/execution/platform_translation.js';

test('builds cTrader amend-position SL/TP request for break-even or target updates', () => {
  assert.deepEqual(buildAmendPositionSLTPMessage({
    clientMsgId: 'm1', accountId: 123, positionId: 456, stopLoss: 2500, takeProfit: 2530,
  }), {
    clientMsgId: 'm1',
    payloadType: 2110,
    payload: { ctidTraderAccountId: 123, positionId: 456, stopLoss: 2500, takeProfit: 2530 },
  });
});

test('builds cTrader close/partial-close and cancel-pending requests', () => {
  assert.deepEqual(buildClosePositionMessage({ clientMsgId: 'm2', accountId: 123, positionId: 456, protocolVolume: 500000 }), {
    clientMsgId: 'm2', payloadType: 2111,
    payload: { ctidTraderAccountId: 123, positionId: 456, volume: 500000 },
  });
  assert.deepEqual(buildCancelOrderMessage({ clientMsgId: 'm3', accountId: 123, orderId: 789 }), {
    clientMsgId: 'm3', payloadType: 2108,
    payload: { ctidTraderAccountId: 123, orderId: 789 },
  });
});

test('translates canonical BE modification into MT5 bridge command', () => {
  const command = buildMT5ManagementCommand({
    type: 'MODIFY_POSITION', brokerPositionId: '9001', stopLoss: 2500, takeProfit: 2530,
  }, { digits: 2, tickSize: 0.01 });
  assert.deepEqual(command, {
    action: 'MODIFY_POSITION', positionId: '9001', stopLoss: 2500, takeProfit: 2530,
  });
});

test('translates canonical cTrader partial close using symbol-specific volume economics', () => {
  const message = buildCTraderManagementCommand({
    type: 'CLOSE_PARTIAL', brokerPositionId: 456, lots: 0.05,
  }, {
    accountId: 123,
    clientMsgId: 'm4',
    symbol: { lotSize: 100000, minVolume: 100000, maxVolume: 1000000000, stepVolume: 100000 },
  });
  assert.equal(message.payloadType, 2111);
  assert.equal(message.payload.positionId, 456);
  assert.equal(message.payload.volume, 500000);
});

test('translates canonical pending cancellation for MT5 and cTrader', () => {
  assert.deepEqual(buildMT5ManagementCommand({ type: 'CANCEL_PENDING', brokerOrderId: '77' }), {
    action: 'CANCEL_PENDING', orderId: '77',
  });
  const cTrader = buildCTraderManagementCommand({ type: 'CANCEL_PENDING', brokerOrderId: 77 }, {
    accountId: 123, clientMsgId: 'm5', symbol: {},
  });
  assert.equal(cTrader.payloadType, 2108);
  assert.equal(cTrader.payload.orderId, 77);
});
