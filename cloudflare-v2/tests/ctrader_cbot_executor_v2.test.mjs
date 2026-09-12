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

function connection(identity = {}) {
  return Response.json({
    ok: true,
    online: true,
    accountRowId: 'row-1',
    identity: {
      accountNumber: '12345678',
      brokerName: 'Test Broker',
      isLive: false,
      symbols: [{ platformSymbol: 'XAUUSD', tradable: true }],
      ...identity,
    },
  });
}

test('cBot executor preflights authenticated broker identity and sends account-bound canonical command', async () => {
  const deliveryStore = store();
  const requests = [];
  const result = await executeCTraderCbotAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', lots: 0.01,
    stopLoss: 3500, takeProfit: 3600, idempotencyKey: 'cmd-1',
  }, {
    workspaceId: 'ws-1', accountRowId: 'row-1', gatewayUrl: 'https://cbot-control.mkety.com',
    controlSecret: 'control-secret', deliveryStore, nowMs: 1000,
    fetchFn: async (url, options = {}) => {
      requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      if ((options.method || 'GET') === 'GET') return connection();
      return Response.json({ ok: true, commandId: 'cmd-1', positionId: 77, fillPrice: 3555.2 });
    },
  });
  assert.equal(requests[0].url, 'https://cbot-control.mkety.com/v1/connections/row-1');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer control-secret');
  assert.equal(requests[1].url, 'https://cbot-control.mkety.com/v1/commands/row-1');
  assert.equal(requests[1].body.account_id, 'row-1');
  assert.equal(requests[1].body.broker_account_id, '12345678');
  assert.equal(requests[1].body.command.action, 'OPEN_POSITION');
  assert.equal(requests[1].body.command.symbol, 'XAUUSD');
  assert.equal(result.brokerPositionId, '77');
  assert.equal(result.fillPrice, 3555.2);
  assert.equal(deliveryStore.calls.at(-1)[0], 'complete');
});

test('cBot executor fails closed when gateway identity is unavailable before reserving delivery', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeCTraderCbotAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'cmd-no-broker',
  }, {
    workspaceId: 'ws-1', accountRowId: 'row-1', gatewayUrl: 'https://cbot-control.mkety.com',
    controlSecret: 'control-secret', deliveryStore,
    fetchFn: async () => Response.json({ ok: false, reason: 'CBOT_OFFLINE' }, { status: 404 }),
  }), (error) => error.code === 'CTRADER_CBOT_OFFLINE');
  assert.equal(deliveryStore.calls.length, 0);
});

test('cBot offline during command delivery is retryable', async () => {
  const deliveryStore = store();
  let calls = 0;
  await assert.rejects(() => executeCTraderCbotAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'cmd-2',
  }, {
    workspaceId: 'ws-1', accountRowId: 'row-1', gatewayUrl: 'https://cbot-control.mkety.com',
    controlSecret: 'control-secret', deliveryStore,
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) return connection();
      return Response.json({ ok: false, reason: 'CBOT_OFFLINE' }, { status: 409 });
    },
  }), (error) => error.code === 'CTRADER_CBOT_OFFLINE' && error.failureClass === 'RETRYABLE');
  assert.equal(deliveryStore.calls.at(-1)[0], 'retryable');
});

test('cBot gateway timeout is uncertain to prevent unsafe duplicate execution', async () => {
  const deliveryStore = store();
  let calls = 0;
  await assert.rejects(() => executeCTraderCbotAction({
    type: 'CLOSE_POSITION', brokerPositionId: '77', symbol: 'XAUUSD', idempotencyKey: 'cmd-3',
  }, {
    workspaceId: 'ws-1', accountRowId: 'row-1', gatewayUrl: 'https://cbot-control.mkety.com',
    controlSecret: 'control-secret', deliveryStore,
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) return connection();
      return Response.json({ ok: false, reason: 'CBOT_RESULT_TIMEOUT' }, { status: 504 });
    },
  }), (error) => error.failureClass === 'UNCERTAIN');
  assert.equal(deliveryStore.calls.at(-1)[0], 'uncertain');
});
