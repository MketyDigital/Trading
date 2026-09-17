import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';
import { buildManagementActions } from '../src/execution/position_group.js';

function openGroup() {
  return {
    id: 'g1',
    symbol: 'XAUUSD',
    entryPrice: 3640,
    orderType: 'MARKET',
    legs: [
      { legId: 'leg-1', targetIndex: 1, brokerPositionId: 'p1', status: 'OPEN', lots: 0.1, takeProfit: 3655 },
      { legId: 'leg-2', targetIndex: 2, brokerPositionId: 'p2', status: 'OPEN', lots: 0.1, takeProfit: 3662 },
      { legId: 'leg-3', targetIndex: 3, brokerPositionId: 'p3', status: 'OPEN', lots: 0.1, takeProfit: 3675 },
    ],
  };
}

test('parses approved break-even aliases deterministically', () => {
  for (const text of ['RISK FREE', 'SET BE', 'SET BREAK EVEN']) {
    assert.deepEqual(buildMachinePlan({ text }), {
      status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' },
    }, text);
  }
});

test('parses explicit stop-loss management prices without opening a trade', () => {
  for (const text of ['TRAIL SL TO 3650', 'MOVE SL 3650', 'MOVE SL TO 3,650.00']) {
    const plan = buildMachinePlan({ text });
    assert.equal(plan.status, 'MANAGEMENT', text);
    assert.equal(plan.management.type, 'MOVE_SL', text);
    assert.equal(plan.management.stopLoss, 3650, text);
  }
});

test('parses take-profit replacement and optional target index', () => {
  assert.deepEqual(buildMachinePlan({ text: 'CHANGE TP TO 3700' }), {
    status: 'MANAGEMENT', management: { type: 'CHANGE_TP', takeProfit: 3700 },
  });
  assert.deepEqual(buildMachinePlan({ text: 'NEW TP2 3,700.00' }), {
    status: 'MANAGEMENT', management: { type: 'CHANGE_TP', takeProfit: 3700, targetIndex: 2 },
  });
});

test('delete pending is an alias for cancel pending and keeps explicit symbol', () => {
  assert.deepEqual(buildMachinePlan({ text: 'DELETE BTCUSD PENDING' }), {
    status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING', symbol: { source: 'BTCUSD', canonical: 'BTCUSD' } },
  });
});

test('target-hit management is correlatable while hold phrases remain informational', () => {
  const tpHit = buildMachinePlan({ text: 'TP1 HIT' });
  assert.equal(tpHit.status, 'MANAGEMENT');
  assert.deepEqual(tpHit.management, { type: 'TARGET_HIT', targetIndex: 1 });

  for (const text of ['HOLD', 'KEEP RUNNING']) {
    const plan = buildMachinePlan({ text });
    assert.equal(plan.status, 'NO_ACTION', text);
    assert.equal(plan.information.type, 'HOLD_POSITION', text);
  }
});

test('conditional explicit-price management remains fail-closed', () => {
  for (const text of ['move SL to 3650 if price rejects', 'maybe change TP to 3700', 'should we trail SL to 3650?']) {
    assert.equal(buildMachinePlan({ text }).status, 'NEEDS_INTERPRETATION', text);
  }
});

test('explicit SL modification applies only to broker-bound open legs and preserves TP', () => {
  const actions = buildManagementActions(openGroup(), { type: 'MOVE_SL', stopLoss: 3650 });
  assert.deepEqual(actions, [
    { type: 'MODIFY_POSITION', legId: 'leg-1', targetIndex: 1, brokerPositionId: 'p1', symbol: 'XAUUSD', stopLoss: 3650, takeProfit: 3655 },
    { type: 'MODIFY_POSITION', legId: 'leg-2', targetIndex: 2, brokerPositionId: 'p2', symbol: 'XAUUSD', stopLoss: 3650, takeProfit: 3662 },
    { type: 'MODIFY_POSITION', legId: 'leg-3', targetIndex: 3, brokerPositionId: 'p3', symbol: 'XAUUSD', stopLoss: 3650, takeProfit: 3675 },
  ]);
});

test('indexed TP modification changes only the intended broker-bound leg', () => {
  const actions = buildManagementActions(openGroup(), { type: 'CHANGE_TP', takeProfit: 3700, targetIndex: 2 });
  assert.deepEqual(actions, [
    { type: 'MODIFY_POSITION', legId: 'leg-2', targetIndex: 2, brokerPositionId: 'p2', symbol: 'XAUUSD', takeProfit: 3700 },
  ]);
});

test('unindexed TP modification targets all open legs explicitly', () => {
  const actions = buildManagementActions(openGroup(), { type: 'CHANGE_TP', takeProfit: 3700 });
  assert.equal(actions.length, 3);
  assert.ok(actions.every((action) => action.type === 'MODIFY_POSITION' && action.takeProfit === 3700));
  assert.deepEqual(actions.map(({ legId, targetIndex }) => ({ legId, targetIndex })), [
    { legId: 'leg-1', targetIndex: 1 },
    { legId: 'leg-2', targetIndex: 2 },
    { legId: 'leg-3', targetIndex: 3 },
  ]);
});
