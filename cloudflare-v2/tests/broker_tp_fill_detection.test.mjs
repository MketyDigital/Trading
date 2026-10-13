import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBrokerTpFill } from '../src/execution/broker_tp_fill_detection.js';

const leg = { brokerPositionId: 'p-1', lots: 1, takeProfit: 1.12, stopLoss: 1.1, targetIndex: 1 };

test('MT5 TP exit is confirmed only when exact position is fully closed by TP deals', () => {
  const result = classifyBrokerTpFill({ platform: 'mt5', leg, snapshot: {
    accountId: 'acct-1', positionId: 'p-1', isOpen: false, initialLots: 1, closedLots: 1,
    deals: [{ dealId: 'd-1', positionId: 'p-1', entry: 'OUT', reason: 'TP', lots: 1 }],
  } });
  assert.deepEqual(result, { status: 'TP_CONFIRMED', positionId: 'p-1', dealIds: ['d-1'] });
});

test('MT5 SL, manual close, partial TP, open position, or mismatched identity never count as TP', () => {
  const base = { accountId: 'acct-1', positionId: 'p-1', isOpen: false, initialLots: 1, closedLots: 1,
    deals: [{ dealId: 'd-1', positionId: 'p-1', entry: 'OUT', reason: 'TP', lots: 1 }] };
  for (const snapshot of [
    { ...base, deals: [{ ...base.deals[0], reason: 'SL' }] },
    { ...base, deals: [{ ...base.deals[0], reason: 'CLIENT' }] },
    { ...base, closedLots: 0.5, deals: [{ ...base.deals[0], lots: 0.5 }] },
    { ...base, isOpen: true },
    { ...base, positionId: 'p-2' },
    { ...base, deals: [{ ...base.deals[0], positionId: 'p-2' }] },
  ]) assert.equal(classifyBrokerTpFill({ platform: 'mt5', leg, snapshot }).status, 'UNRESOLVED');
});

test('cTrader requires protective closing order and execution at the TP price', () => {
  const snapshot = { accountId: 'acct-1', positionId: 'p-1', isOpen: false, initialLots: 1, closedLots: 1,
    deals: [{ dealId: 'd-2', positionId: 'p-1', lots: 1, executionPrice: 1.12 }],
    closingOrders: [{ orderId: 'o-1', positionId: 'p-1', closingOrder: true, orderType: 'STOP_LOSS_TAKE_PROFIT', takeProfit: 1.12, stopLoss: 1.1 }],
    tickSize: 0.00001 };
  assert.deepEqual(classifyBrokerTpFill({ platform: 'ctrader', leg, snapshot }),
    { status: 'TP_CONFIRMED', positionId: 'p-1', dealIds: ['d-2'] });
});

test('cTrader allows broker slippage only when the fill is clearly closer to TP than SL', () => {
  const result = classifyBrokerTpFill({ platform: 'ctrader', leg, snapshot: {
    accountId: 'acct-1', positionId: 'p-1', isOpen: false, initialLots: 1, closedLots: 1,
    deals: [{ dealId: 'd-2', positionId: 'p-1', lots: 1, executionPrice: 1.1198 }],
    closingOrders: [{ orderId: 'o-1', positionId: 'p-1', closingOrder: true, orderType: 'STOP_LOSS_TAKE_PROFIT', takeProfit: 1.12, stopLoss: 1.1 }],
    tickSize: 0.00001,
  } });
  assert.equal(result.status, 'TP_CONFIRMED');
});

test('cTrader refuses SL, manual close, partial fill, missing close order, and ambiguous execution price', () => {
  const base = { accountId: 'acct-1', positionId: 'p-1', isOpen: false, initialLots: 1, closedLots: 1,
    deals: [{ dealId: 'd-2', positionId: 'p-1', lots: 1, executionPrice: 1.12 }],
    closingOrders: [{ orderId: 'o-1', positionId: 'p-1', closingOrder: true, orderType: 'STOP_LOSS_TAKE_PROFIT', takeProfit: 1.12, stopLoss: 1.1 }], tickSize: 0.00001 };
  for (const snapshot of [
    { ...base, deals: [{ ...base.deals[0], executionPrice: 1.1 }] },
    { ...base, closingOrders: [] },
    { ...base, closedLots: 0.5, deals: [{ ...base.deals[0], lots: 0.5 }] },
    { ...base, deals: [{ ...base.deals[0], executionPrice: 1.11 }] },
    { ...base, closingOrders: [{ ...base.closingOrders[0], closingOrder: false }] },
  ]) assert.equal(classifyBrokerTpFill({ platform: 'ctrader', leg, snapshot }).status, 'UNRESOLVED');
});
