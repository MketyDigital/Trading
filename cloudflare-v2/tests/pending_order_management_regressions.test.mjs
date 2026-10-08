import test from 'node:test';
import assert from 'node:assert/strict';

import { buildManagementActions } from '../src/execution/position_group.js';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';
import { executeCTraderAction } from '../src/adapters/ctrader_executor_v2.js';
import { executeMt5ConnectorAction } from '../src/adapters/mt5_connector_executor_v2.js';

const ctraderSymbol = {
  platform: 'ctrader', platformId: 1, platformSymbol: 'EUR/USD', canonical: 'EURUSD',
  digits: 5, tickSize: 0.00001, protocolLotSize: 10000000,
  minVolume: 100000, maxVolume: 1000000000, stepVolume: 100000,
};

function deliveryStore() {
  return {
    completed: [],
    failed: [],
    async reserve() { return { ok: true, duplicate: false }; },
    async complete(key, result) { this.completed.push({ key, result }); },
    async fail(key, failure) { this.failed.push({ key, failure }); },
  };
}

test('standalone delete and delete order replies are normalized to pending cancellation', () => {
  for (const text of ['Delete', 'Delete order', 'Delete it', 'Delete this', 'Delete that', 'Cancel order', 'Cancel it', 'Cancel this', 'Remove order', 'Remove it', 'Remove this']) {
    const plan = buildMachinePlan({ text });
    assert.equal(plan.status, 'MANAGEMENT');
    assert.equal(plan.management.type, 'CANCEL_PENDING');
  }
});

test('delete reply with a channel footer cancels the replied-to pending order', () => {
  const text = 'Delete ❌ LIMIT trade join 👇\n\n⭐️⭐️⭐️Become a VIP member => https://easyforexpips.com\n💻📱Our XAUUSD Channel👉 CLICK HERE';
  const plan = buildMachinePlan({
    text,
    thread: { reply_to_event_id: 'telegram:-1001284268486:58957' },
  });

  assert.equal(plan.status, 'MANAGEMENT');
  assert.equal(plan.management.type, 'CANCEL_PENDING');
});

test('delete wording without an explicit order reply does not become a pending cancellation', () => {
  const plan = buildMachinePlan({
    text: 'Delete ❌ LIMIT trade join 👇\n\n⭐️ Become a VIP member',
  });

  assert.notEqual(plan.status, 'MANAGEMENT');
});

test('close on a pending limit leg cancels the broker order instead of closing a position', () => {
  const actions = buildManagementActions({
    symbol: 'EURUSD',
    orderType: 'LIMIT',
    legs: [{
      legId: 'leg-1', targetIndex: 1, status: 'PENDING',
      brokerPositionId: null, brokerOrderId: 'order-101', lots: 0.01,
    }],
  }, { type: 'CLOSE' });

  assert.deepEqual(actions, [{
    type: 'CANCEL_PENDING',
    legId: 'leg-1',
    targetIndex: 1,
    brokerOrderId: 'order-101',
    symbol: 'EURUSD',
  }]);
});

test('close cancels pending legs and closes filled legs in the same group', () => {
  const actions = buildManagementActions({
    symbol: 'EURUSD',
    orderType: 'LIMIT',
    legs: [
      { legId: 'leg-1', targetIndex: 1, status: 'PENDING', brokerPositionId: null, brokerOrderId: 'order-101', lots: 0.01 },
      { legId: 'leg-2', targetIndex: 2, status: 'OPEN', brokerPositionId: 'position-202', brokerOrderId: null, lots: 0.02 },
    ],
  }, { type: 'CLOSE' });

  assert.deepEqual(actions, [
    { type: 'CLOSE_POSITION', legId: 'leg-2', targetIndex: 2, brokerPositionId: 'position-202', symbol: 'EURUSD', lots: 0.02 },
    { type: 'CANCEL_PENDING', legId: 'leg-1', targetIndex: 1, brokerOrderId: 'order-101', symbol: 'EURUSD' },
  ]);
});

test('cTrader accepted limit with an unfilled order ID persists as pending, not an open position', async () => {
  const store = deliveryStore();
  const result = await executeCTraderAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'LIMIT', symbol: 'EURUSD',
    entry: { kind: 'PRICE', value: 1.11734 }, lots: 0.01,
    stopLoss: 1.11615, takeProfit: 1.12127, idempotencyKey: 'pending-ctrader',
  }, {
    session: {
      async request() {
        return {
          payloadType: 2126,
          payload: {
            executionType: 2,
            order: { orderId: 7001, orderType: 2, orderStatus: 1, executedVolume: 0, clientOrderId: 'pending-ctrader' },
            position: { positionId: 7001, positionStatus: 3, price: 0 },
          },
        };
      },
    },
    accountId: 77,
    catalog: [ctraderSymbol],
    deliveryStore: store,
  });

  assert.equal(result.status, 'PENDING');
  assert.equal(result.brokerPositionId, null);
  assert.equal(result.brokerOrderId, 7001);
  assert.equal(store.completed.length, 1);
});

test('MT5 accepted limit with no fill persists only the pending broker order ID', async () => {
  const store = deliveryStore();
  const fetchFn = async (_url, options = {}) => {
    if (!options.method || options.method === 'GET') {
      return {
        ok: true, status: 200,
        async json() {
          return {
            online: true,
            accountRowId: 'mt5-row-1',
            identity: { accountNumber: '12345678', serverName: 'Demo-Server', isLive: false },
          };
        },
      };
    }
    return {
      ok: true, status: 200,
      async json() {
        return {
          ok: true, type: 'result', retcode: 10009,
          orderId: 'ticket-9001', positionId: 'ticket-9001',
          dealId: null, fillPrice: 0,
        };
      },
    };
  };

  const result = await executeMt5ConnectorAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'LIMIT', symbol: 'EURUSD',
    entry: { kind: 'PRICE', value: 1.11734 }, lots: 0.01,
    stopLoss: 1.11615, takeProfit: 1.12127, idempotencyKey: 'pending-mt5',
  }, {
    workspaceId: 'ws-1',
    accountRowId: 'mt5-row-1',
    gatewayUrl: 'https://gateway.example',
    controlSecret: 'test-only',
    expectedBrokerAccountId: '12345678',
    expectedServerName: 'Demo-Server',
    expectedEnvironment: 'demo',
    symbolCatalog: [{
      platformSymbol: 'EURUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01,
      digits: 5, tickSize: 0.00001,
    }],
    deliveryStore: store,
    fetchFn,
  });

  assert.equal(result.status, 'PENDING');
  assert.equal(result.brokerPositionId, null);
  assert.equal(result.brokerOrderId, 'ticket-9001');
  assert.equal(store.completed.length, 1);
});

test('cTrader position-not-found reconciliation does not call an order closed while that order is still pending', async () => {
  const store = deliveryStore();
  const notFound = new Error('POSITION_NOT_FOUND: Position not found with id 7002');
  notFound.code = 'POSITION_NOT_FOUND';
  notFound.deliveryFailureClass = 'TERMINAL';

  await assert.rejects(() => executeCTraderAction({
    type: 'CLOSE_POSITION', brokerPositionId: 7002, brokerOrderId: 7002,
    lots: 0.01, symbol: 'EURUSD', idempotencyKey: 'close-still-pending',
  }, {
    session: {
      async request(message) {
        if (message.payloadType === 2111) throw notFound;
        if (message.payloadType === 2124) {
          return {
            payloadType: 2125,
            payload: {
              position: [],
              order: [{ orderId: 7002, orderType: 2, orderStatus: 1, executedVolume: 0 }],
            },
          };
        }
        throw new Error('unexpected request');
      },
    },
    accountId: 77,
    catalog: [ctraderSymbol],
    deliveryStore: store,
  }), (error) => error?.code === 'POSITION_NOT_FOUND');

  assert.equal(store.completed.length, 0);
  assert.equal(store.failed.length, 1);
});
