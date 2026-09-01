import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePositionMode,
  materializePositionGroupForAccount,
  bindNettedBrokerPosition,
  buildNettedTargetAction,
} from '../src/execution/position_mode.js';

const group = {
  id: 'g1', symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET', entry: { kind: 'MARKET' }, stopLoss: 2490,
  legs: [
    { legId: 'leg-1', targetIndex: 1, lots: 0.04, stopLoss: 2490, takeProfit: 2510, status: 'PLANNED' },
    { legId: 'leg-2', targetIndex: 2, lots: 0.03, stopLoss: 2490, takeProfit: 2520, status: 'PLANNED' },
    { legId: 'leg-3', targetIndex: 3, lots: 0.03, stopLoss: 2490, takeProfit: 2530, status: 'PLANNED' },
  ],
};

test('normalizes cTrader and MT5 account position modes', () => {
  assert.equal(normalizePositionMode('ctrader', { accountType: 0 }), 'HEDGED');
  assert.equal(normalizePositionMode('ctrader', { accountType: 1 }), 'NETTED');
  assert.equal(normalizePositionMode('mt5', { margin_mode: 2 }), 'HEDGED');
  assert.equal(normalizePositionMode('mt5', { margin_mode: 0 }), 'NETTED');
  assert.equal(normalizePositionMode('mt5', { margin_mode: 1 }), 'NETTED');
});

test('hedged account keeps one real broker position per TP leg', () => {
  const result = materializePositionGroupForAccount(group, { positionMode: 'HEDGED' });
  assert.equal(result.actions.length, 3);
  assert.deepEqual(result.actions.map((action) => action.takeProfit), [2510, 2520, 2530]);
  assert.ok(result.group.legs.every((leg) => leg.executionMode === 'REAL_POSITION'));
});

test('netted account opens one total position and keeps TP legs virtual', () => {
  const result = materializePositionGroupForAccount(group, { positionMode: 'NETTED' });
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].lots, 0.10);
  assert.equal(result.actions[0].takeProfit, 2530);
  assert.equal(result.actions[0].stopLoss, 2490);
  assert.ok(result.group.legs.every((leg) => leg.executionMode === 'VIRTUAL_LEG'));
  assert.deepEqual(result.group.virtualTargets.map((target) => [target.targetIndex, target.lots, target.takeProfit]), [
    [1, 0.04, 2510], [2, 0.03, 2520], [3, 0.03, 2530]
  ]);
});

test('binds one netted broker position id to every virtual leg for management correlation', () => {
  const materialized = materializePositionGroupForAccount(group, { positionMode: 'NETTED' }).group;
  const bound = bindNettedBrokerPosition(materialized, 'position-900');
  assert.ok(bound.legs.every((leg) => leg.brokerPositionId === 'position-900'));
});

test('netted TP1 produces partial close for TP1 allocation while final target is left to broker TP', () => {
  const materialized = bindNettedBrokerPosition(materializePositionGroupForAccount(group, { positionMode: 'NETTED' }).group, 'p1');
  assert.deepEqual(buildNettedTargetAction(materialized, 1), {
    type: 'CLOSE_PARTIAL', brokerPositionId: 'p1', targetIndex: 1, lots: 0.04,
  });
  assert.deepEqual(buildNettedTargetAction(materialized, 2), {
    type: 'CLOSE_PARTIAL', brokerPositionId: 'p1', targetIndex: 2, lots: 0.03,
  });
  assert.equal(buildNettedTargetAction(materialized, 3), null);
});
