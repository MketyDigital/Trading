import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMT5Action } from '../src/adapters/mt5_executor_v2.js';
import { verifyMT5BridgeSignature } from '../src/adapters/mt5_bridge_protocol.js';

const symbol = {
  platform: 'mt5', platformSymbol: 'XAUUSD.a', canonical: 'XAUUSD', aliases: ['GOLD'],
  digits: 2, tickSize: 0.01, minLots: 0.01, maxLots: 100, stepLots: 0.01,
};

function deliveryStore({ duplicate = false } = {}) {
  const completed = [];
  return {
    completed,
    reserve: async (key) => duplicate ? { duplicate: true, result: { brokerPositionId: '900' } } : { ok: true },
    complete: async (key, result) => completed.push({ key, result }),
    fail: async () => {},
  };
}

test('translates, signs and dispatches canonical MT5 open action', async () => {
  let request;
  const result = await executeMT5Action({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', entry: { kind: 'MARKET' },
    lots: 0.03, stopLoss: 2518, takeProfit: 2535, idempotencyKey: 'evt1-acct1-leg1',
  }, {
    workspaceId: 'ws-1', accountId: 'acct-1', bridgeUrl: 'https://bridge.test/v1/command', bridgeSecret: 'secret',
    catalog: [symbol], deliveryStore: deliveryStore(), nowMs: 1700000000000,
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ ok: true, ticket: 900, position_id: 900, order_id: 901 }) };
    },
  });
  assert.equal(request.url, 'https://bridge.test/v1/command');
  const body = JSON.parse(request.options.body);
  assert.equal(body.command_id, 'evt1-acct1-leg1');
  assert.equal(body.command.symbol, 'XAUUSD.a');
  assert.equal(body.command.volume, 0.03);
  assert.equal(await verifyMT5BridgeSignature(request.options.body, 'secret', request.options.headers['X-Mkety-Signature']), true);
  assert.equal(result.brokerPositionId, '900');
  assert.equal(result.brokerOrderId, '901');
});

test('sends canonical management action using resolved MT5 symbol constraints', async () => {
  let body;
  await executeMT5Action({
    type: 'CLOSE_PARTIAL', brokerPositionId: '900', symbol: 'XAUUSD', lots: 0.025, idempotencyKey: 'tp1-close',
  }, {
    workspaceId: 'ws-1', accountId: 'acct-1', bridgeUrl: 'https://bridge.test/v1/command', bridgeSecret: 'secret',
    catalog: [symbol], deliveryStore: deliveryStore(),
    fetchFn: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true, position_id: 900 }) }; },
  });
  assert.equal(body.command.action, 'CLOSE_PARTIAL');
  assert.equal(body.command.positionId, '900');
  assert.equal(body.command.volume, 0.03);
});

test('persistent duplicate reservation prevents second MT5 bridge call', async () => {
  let called = false;
  const result = await executeMT5Action({
    type: 'CLOSE_POSITION', brokerPositionId: '900', symbol: 'XAUUSD', lots: 0.03, idempotencyKey: 'done-before',
  }, {
    workspaceId: 'ws-1', accountId: 'acct-1', bridgeUrl: 'https://bridge.test', bridgeSecret: 'secret', catalog: [symbol],
    deliveryStore: deliveryStore({ duplicate: true }), fetchFn: async () => { called = true; },
  });
  assert.equal(result.duplicate, true);
  assert.equal(called, false);
});

test('bridge rejection is recorded and surfaced rather than treated as success', async () => {
  let failed = false;
  const store = deliveryStore();
  store.fail = async () => { failed = true; };
  await assert.rejects(() => executeMT5Action({
    type: 'OPEN_POSITION', side: 'SELL', orderType: 'MARKET', symbol: 'XAUUSD', entry: { kind: 'MARKET' }, lots: 0.03,
    idempotencyKey: 'bad-order',
  }, {
    workspaceId: 'ws-1', accountId: 'acct-1', bridgeUrl: 'https://bridge.test', bridgeSecret: 'secret', catalog: [symbol], deliveryStore: store,
    fetchFn: async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'order_check failed' }) }),
  }), /order_check failed/);
  assert.equal(failed, true);
});
