import test from 'node:test';
import assert from 'node:assert/strict';
import { readCTraderPendingOrderStatus } from '../src/adapters/ctrader_pending_order_status.js';

const context = {
  accountRowId: 'account-row-1', accountId: 12345, brokerAccountNumber: '12345',
  serverName: 'Broker-Demo', environment: 'demo', isLive: false,
  brokerOrderId: '9001', protocolLotSize: 10000, nowMs: 2000,
};

function session(response) {
  const responses = Array.isArray(response) ? [...response] : [response];
  return {
    calls: [],
    async request(message, options) { this.calls.push({ message, options }); return responses.shift(); },
  };
}

function reconciliationResponse(positionIds = [501]) {
  return { payloadType: 2125, payload: { ctidTraderAccountId: 12345,
    position: positionIds.map((positionId) => ({ positionId })) } };
}

function orderResponse(overrides = {}) {
  return {
    payloadType: 2182,
    payload: {
      ctidTraderAccountId: 12345,
      order: {
        orderId: 9001, orderStatus: 1, executedVolume: 4000,
        tradeData: { volume: 10000 }, utcLastUpdateTimestamp: 1900,
      },
      deal: [
        { orderId: 9001, dealId: 11, positionId: 501, filledVolume: 2500, executionPrice: 1.08, dealStatus: 2 },
        { orderId: 9001, dealId: 12, positionId: 501, filledVolume: 1500, executionPrice: 1.082, dealStatus: 2 },
      ],
    },
    ...overrides,
  };
}

test('reads exact cTrader order details and normalizes multiple fills into one manageable position', async () => {
  const api = session([orderResponse(), reconciliationResponse()]);
  const result = await readCTraderPendingOrderStatus({ ...context, session: api });

  assert.deepEqual(result, {
    accountRowId: 'account-row-1', brokerAccountNumber: '12345', serverName: 'Broker-Demo', environment: 'demo', isLive: false,
    snapshot: {
      status: 'PARTIALLY_FILLED', remainingLots: 0.6,
      fills: [{ dealId: '11', dealIds: ['11', '12'], positionId: '501', lots: 0.4, fillPrice: 1.08075, isOpen: true }],
      observedAt: 1900, sourceVersion: '1:4000:1900',
    },
  });
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[0].message.payloadType, 2181);
  assert.deepEqual(api.calls[0].message.payload, { ctidTraderAccountId: 12345, orderId: 9001 });
  assert.deepEqual(api.calls[0].options, { successPayloadTypes: [2182] });
  assert.equal(api.calls[1].message.payloadType, 2124);
  assert.deepEqual(api.calls[1].options, { successPayloadTypes: [2125] });
});

test('returns unresolved on wrong account, wrong order, incomplete fill mapping, or invalid volume evidence', async () => {
  for (const response of [
    orderResponse({ payload: { ...orderResponse().payload, ctidTraderAccountId: 999 } }),
    orderResponse({ payload: { ...orderResponse().payload, order: { ...orderResponse().payload.order, orderId: 999 } } }),
    orderResponse({ payload: { ...orderResponse().payload, deal: [{ ...orderResponse().payload.deal[0], positionId: null }] } }),
    orderResponse({ payload: { ...orderResponse().payload, deal: [{ ...orderResponse().payload.deal[0], filledVolume: 0 }] } }),
  ]) {
    const result = await readCTraderPendingOrderStatus({ ...context, session: session([response, reconciliationResponse()]) });
    assert.equal(result.snapshot.status, 'UNRESOLVED');
  }
});

test('maps fully filled and cancelled cTrader orders without fabricating filled volume', async () => {
  const filled = orderResponse({ payload: {
    ...orderResponse().payload,
    order: { ...orderResponse().payload.order, orderStatus: 2, executedVolume: 10000 },
    deal: [{ ...orderResponse().payload.deal[0], filledVolume: 10000 }],
  } });
  const cancelled = orderResponse({ payload: {
    ...orderResponse().payload,
    order: { ...orderResponse().payload.order, orderStatus: 5, executedVolume: 4000 },
  } });

  assert.equal((await readCTraderPendingOrderStatus({ ...context, session: session([filled, reconciliationResponse()]) })).snapshot.status, 'FILLED');
  const cancellation = await readCTraderPendingOrderStatus({ ...context, session: session([cancelled, reconciliationResponse()]) });
  assert.equal(cancellation.snapshot.status, 'CANCELLED');
  assert.equal(cancellation.snapshot.remainingLots, 0);

  const rejected = orderResponse({ payload: {
    ...orderResponse().payload,
    order: { ...orderResponse().payload.order, orderStatus: 3, executedVolume: 0 },
    deal: [],
  } });
  const rejection = await readCTraderPendingOrderStatus({ ...context, session: session([rejected, reconciliationResponse()]) });
  assert.equal(rejection.snapshot.status, 'CANCELLED');
});

test('marks historical cTrader fills closed when the broker no longer reports their positions open', async () => {
  const closedPosition = orderResponse();
  const result = await readCTraderPendingOrderStatus({ ...context, session: session([closedPosition, reconciliationResponse([])]) });
  assert.equal(result.snapshot.status, 'PARTIALLY_FILLED');
  assert.equal(result.snapshot.fills[0].isOpen, false);
});
