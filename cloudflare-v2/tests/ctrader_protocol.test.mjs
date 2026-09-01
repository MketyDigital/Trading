import test from 'node:test';
import assert from 'node:assert/strict';
import { ctraderEndpoint, buildApplicationAuthMessage, buildAccountAuthMessage, buildNewOrderMessage } from '../src/adapters/ctrader_protocol.js';

test('uses the official JSON websocket port for cTrader JSON protocol', () => {
  assert.equal(ctraderEndpoint('demo', 'json'), 'wss://demo.ctraderapi.com:5036');
  assert.equal(ctraderEndpoint('live', 'json'), 'wss://live.ctraderapi.com:5036');
  assert.equal(ctraderEndpoint('demo', 'protobuf'), 'wss://demo.ctraderapi.com:5035');
});

test('builds application and account authentication messages', () => {
  assert.equal(buildApplicationAuthMessage('id', 'secret', 'm1').payloadType, 2100);
  assert.deepEqual(buildAccountAuthMessage(123, 'token', 'm2').payload, { ctidTraderAccountId: 123, accessToken: 'token' });
});

test('builds cTrader new order using symbolId and protocol volume', () => {
  const msg = buildNewOrderMessage({
    clientMsgId: 'm3', accountId: 123, symbolId: 41, side: 'BUY', orderType: 'LIMIT', protocolVolume: 100000,
    entryPrice: 2526.5, stopLoss: 2518, takeProfit: 2535
  });
  assert.equal(msg.payloadType, 2106);
  assert.equal(msg.payload.ctidTraderAccountId, 123);
  assert.equal(msg.payload.symbolId, 41);
  assert.equal(msg.payload.volume, 100000);
  assert.equal(msg.payload.orderType, 2);
  assert.equal(msg.payload.limitPrice, 2526.5);
  assert.equal(msg.payload.stopLoss, 2518);
  assert.equal(msg.payload.takeProfit, 2535);
});
