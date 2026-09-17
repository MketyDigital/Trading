import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateVolumeAcrossTargets, buildPositionGroup, reconcileFastEntry, buildManagementActions } from '../src/execution/position_group.js';

const intent = {
  side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD', source: 'GOLD' }, entry: { kind: 'PRICE', value: 2526 },
  stopLoss: 2518, takeProfits: [2530, 2535, 2545], fastEntry: false, incomplete: false
};

test('splits total canonical lots across targets while respecting step and preserving total', () => {
  assert.deepEqual(allocateVolumeAcrossTargets(0.09, 3, 0.01), [0.03, 0.03, 0.03]);
  assert.deepEqual(allocateVolumeAcrossTargets(0.10, 3, 0.01), [0.04, 0.03, 0.03]);
});

test('builds a three-leg position group with one TP per child position', () => {
  const group = buildPositionGroup(intent, { totalLots: 0.09, volumeStep: 0.01 });
  assert.equal(group.legs.length, 3);
  assert.deepEqual(group.legs.map((leg) => leg.takeProfit), [2530, 2535, 2545]);
  assert.deepEqual(group.legs.map((leg) => leg.lots), [0.03, 0.03, 0.03]);
  assert.ok(group.legs.every((leg) => leg.stopLoss === 2518));
});

test('promotes a fast first position to TP1 and creates only missing TP legs', () => {
  const existing = {
    id: 'group-fast', symbol: 'XAUUSD', side: 'BUY',
    legs: [{ legId: 'leg-1', brokerPositionId: 'p100', lots: 0.03, status: 'OPEN', takeProfit: null, stopLoss: null }]
  };
  const result = reconcileFastEntry(existing, intent, { totalLots: 0.09, volumeStep: 0.01 });
  assert.equal(result.actions.filter((a) => a.type === 'MODIFY_POSITION').length, 1);
  assert.equal(result.actions.filter((a) => a.type === 'OPEN_POSITION').length, 2);
  assert.deepEqual(result.actions.filter((a) => a.type === 'OPEN_POSITION').map((a) => a.takeProfit), [2535, 2545]);
  assert.equal(result.actions[0].takeProfit, 2530);
  assert.equal(result.actions[0].stopLoss, 2518);
  assert.equal(result.actions[0].symbol, 'XAUUSD');
  assert.equal(result.actions[0].legId, 'leg-1');
});

test('generates break-even changes only for remaining open legs and retains symbol context', () => {
  const group = {
    symbol: 'XAUUSD', entryPrice: 2526,
    legs: [
      { legId: '1', brokerPositionId: 'p1', status: 'CLOSED' },
      { legId: '2', brokerPositionId: 'p2', status: 'OPEN' },
      { legId: '3', brokerPositionId: 'p3', status: 'OPEN' }
    ]
  };
  const actions = buildManagementActions(group, { type: 'MOVE_SL_TO_BE' });
  assert.deepEqual(actions, [
    { type: 'MODIFY_POSITION', managementType: 'MOVE_SL_TO_BE', legId: '2', targetIndex: undefined, brokerPositionId: 'p2', symbol: 'XAUUSD', side: undefined, entryPrice: 2526, stopLoss: 2526 },
    { type: 'MODIFY_POSITION', managementType: 'MOVE_SL_TO_BE', legId: '3', targetIndex: undefined, brokerPositionId: 'p3', symbol: 'XAUUSD', side: undefined, entryPrice: 2526, stopLoss: 2526 }
  ]);
});

test('full close actions preserve each open leg volume, identity, and symbol context', () => {
  const group = {
    symbol: 'XAUUSD',
    legs: [
      { legId: '1', brokerPositionId: 'p1', lots: 0.04, status: 'OPEN' },
      { legId: '2', brokerPositionId: 'p2', lots: 0.03, status: 'OPEN' },
      { legId: '3', brokerPositionId: 'p3', lots: 0.03, status: 'CLOSED' }
    ]
  };
  assert.deepEqual(buildManagementActions(group, { type: 'CLOSE_ALL' }), [
    { type: 'CLOSE_POSITION', legId: '1', targetIndex: undefined, brokerPositionId: 'p1', symbol: 'XAUUSD', lots: 0.04 },
    { type: 'CLOSE_POSITION', legId: '2', targetIndex: undefined, brokerPositionId: 'p2', symbol: 'XAUUSD', lots: 0.03 }
  ]);
});

test('explicit lot partial close uses the existing CLOSE_PARTIAL broker action without inventing a new action type', () => {
  const group = {
    symbol: 'XAUUSD',
    legs: [{ legId: '1', targetIndex: 1, brokerPositionId: 'p1', lots: 0.05, volumeStepLots: 0.01, status: 'OPEN' }],
  };
  assert.deepEqual(buildManagementActions(group, { type: 'CLOSE_PARTIAL', lots: 0.01 }), [
    { type: 'CLOSE_PARTIAL', legId: '1', targetIndex: 1, brokerPositionId: 'p1', symbol: 'XAUUSD', lots: 0.01 },
  ]);
});

test('explicit lot partial close fails closed when requested lots would fully close the leg', () => {
  const group = {
    symbol: 'XAUUSD',
    legs: [{ legId: '1', targetIndex: 1, brokerPositionId: 'p1', lots: 0.01, volumeStepLots: 0.01, status: 'OPEN' }],
  };
  assert.throws(() => buildManagementActions(group, { type: 'CLOSE_PARTIAL', lots: 0.01 }), /without full close/i);
});

test('remove SL and indexed TP become explicit protection-clear MODIFY_POSITION actions', () => {
  const group = {
    symbol: 'XAUUSD',
    legs: [
      { legId: '1', targetIndex: 1, brokerPositionId: 'p1', status: 'OPEN' },
      { legId: '2', targetIndex: 2, brokerPositionId: 'p2', status: 'OPEN' },
    ],
  };
  assert.deepEqual(buildManagementActions(group, { type: 'REMOVE_SL' }), [
    { type: 'MODIFY_POSITION', managementType: 'REMOVE_SL', legId: '1', targetIndex: 1, brokerPositionId: 'p1', symbol: 'XAUUSD', clearStopLoss: true },
    { type: 'MODIFY_POSITION', managementType: 'REMOVE_SL', legId: '2', targetIndex: 2, brokerPositionId: 'p2', symbol: 'XAUUSD', clearStopLoss: true },
  ]);
  assert.deepEqual(buildManagementActions(group, { type: 'REMOVE_TP', targetIndex: 2 }), [
    { type: 'MODIFY_POSITION', managementType: 'REMOVE_TP', legId: '2', targetIndex: 2, brokerPositionId: 'p2', symbol: 'XAUUSD', clearTakeProfit: true },
  ]);
});
