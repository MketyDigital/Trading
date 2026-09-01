import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ctraderEndpoint,
  buildApplicationAuthMessage,
  buildAccountAuthMessage,
  buildNewOrderMessage,
  buildSymbolsListMessage,
  buildSymbolByIdMessage,
  buildSubscribeSpotsMessage,
  decodeSpotEvent,
} from '../src/adapters/ctrader_protocol.js';

test('uses the official JSON websocket port for cTrader JSON protocol', () => {
  assert.equal(ctraderEndpoint('demo', 'json'), 'wss://demo.ctraderapi.com:5036');
  assert.equal(ctraderEndpoint('live', 'json'), 'wss://live.ctraderapi.com:5036');
  assert.equal(ctraderEndpoint('demo', 'protobuf'), 'wss://demo.ctraderapi.com:5035');
});

test('builds application and account authentication messages', () => {
  assert.equal(buildApplicationAuthMessage('id', 'secret', 'm1').payloadType, 2100);
  assert.deepEqual(buildAccountAuthMessage(123, 'token', 'm2').payload, { ctidTraderAccountId: 123, accessToken: 'token' });
});

test('builds account symbol catalog and full symbol detail requests', () => {
  assert.deepEqual(buildSymbolsListMessage({ clientMsgId: 's1', accountId: 123 }), {
    clientMsgId: 's1', payloadType: 2114,
    payload: { ctidTraderAccountId: 123, includeArchivedSymbols: false },
  });
  assert.deepEqual(buildSymbolByIdMessage({ clientMsgId: 's2', accountId: 123, symbolIds: [41, 42] }), {
    clientMsgId: 's2', payloadType: 2116,
    payload: { ctidTraderAccountId: 123, symbolId: [41, 42] },
  });
});

test('builds spot subscription and decodes cTrader relative bid ask prices', () => {
  assert.deepEqual(buildSubscribeSpotsMessage({ clientMsgId: 'q1', accountId: 123, symbolIds: [41] }), {
    clientMsgId: 'q1', payloadType: 2127,
    payload: { ctidTraderAccountId: 123, symbolId: [41], subscribeToSpotTimestamp: true },
  });
  assert.deepEqual(decodeSpotEvent({ payloadType: 2131, payload: { ctidTraderAccountId: 123, symbolId: 41, bid: 252612345, ask: 252632345, timestamp: 1700000000000 } }, { digits: 3 }), {
    accountId: 123, symbolId: 41, bid: 2526.123, ask: 2526.323, timestamp: 1700000000000,
  });
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
