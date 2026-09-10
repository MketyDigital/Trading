import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCTraderCbotAction } from '../src/adapters/ctrader_cbot_executor_v2.js';

function store() {
  const calls = [];
  return {
    calls,
    async reserve(key, value) { calls.push(['reserve', key, value]); return { ok: true }; },
    async complete(key, value) { calls.push(['complete', key, value]); },
    async fail(key, value) { calls.push(['fail', key, value]); },
    async markRetryable(key, value) { calls.push(['retryable', key, value]); },
    async markUncertain(key, value) { calls.push(['uncertain', key, value]); },
  };
}

test('cBot executor sends account-bound canonical command to shared gateway', async () => {
  const deliveryStore = store();
  let request;
  const result = await executeCTraderCbotAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', lots: 0.01,
    stopLoss: 3500, takeProfit: 3600, idempotencyKey: 'cmd-1',
  }, {
    workspaceId: 'ws-1', accountRowId: 'row-1', gatewayUrl: 'https://cbot-control.mkety.com',
    controlSecret: 'control-secret', deliveryStore, nowMs: 1000,
    fetchFn: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return Response.json({ ok: true, commandId: 'cmd-1', positionId: 77, fillPrice: 3555.2 });
    },
  });
  assert.equal(request.url, 'https://cbot-control.mkety.com/v1/commands/row-1');
  assert.equal(request.options.headers.Authorization, 'Bearer control-secret');
  assert.equal(request.body.account_id, 'row-1');
  assert.equal(request.body.command.action, 'OPEN_POSITION');
  assert.equal(request.body.command.symbol, 'XAUUSD');
  assert.equal(result.brokerPositionId, '77');
  assert.equal(result.fillPrice, 3555.2);
  assert.equal(deliveryStore.calls.at(-1)[0], 'complete');
});

test('cBot offline is retryable before execution result is accepted', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeCTraderCbotAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'cmd-2',
  }, {
    workspaceId: 'ws-1', accountRowId: 'row-1', gatewayUrl: 'https://cbot-control.mkety.com',
    controlSecret: 'control-secret', deliveryStore,
    fetchFn: async () => Response.json({ ok: false, reason: 'CBOT_OFFLINE' }, { status: 409 }),
  }), (error) => error.code === 'CTRADER_CBOT_OFFLINE' && error.failureClass === 'RETRYABLE');
  assert.equal(deliveryStore.calls.at(-1)[0], 'retryable');
});

test('cBot gateway timeout is uncertain to prevent unsafe duplicate execution', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeCTraderCbotAction({
    type: 'CLOSE_POSITION', brokerPositionId: '77', symbol: 'XAUUSD', idempotencyKey: 'cmd-3',
  }, {
    workspaceId: 'ws-1', accountRowId: 'row-1', gatewayUrl: 'https://cbot-control.mkety.com',
    controlSecret: 'control-secret', deliveryStore,
    fetchFn: async () => Response.json({ ok: false, reason: 'CBOT_RESULT_TIMEOUT' }, { status: 504 }),
  }), (error) => error.failureClass === 'UNCERTAIN');
  assert.equal(deliveryStore.calls.at(-1)[0], 'uncertain');
});
