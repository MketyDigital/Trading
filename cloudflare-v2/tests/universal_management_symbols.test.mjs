import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMachinePlan } from '../src/pipeline/machine_plan.js';

function assertEntrySymbol(text, expectedCanonical) {
  const plan = buildMachinePlan({ text });
  assert.equal(plan.status, 'READY', text);
  assert.equal(plan.intent.symbol.canonical, expectedCanonical, text);
  return plan;
}

function assertManagementSymbol(text, expectedType, expectedCanonical) {
  const plan = buildMachinePlan({ text });
  assert.equal(plan.status, 'MANAGEMENT', text);
  assert.equal(plan.management.type, expectedType, text);
  assert.equal(plan.management.symbol?.canonical, expectedCanonical, text);
  return plan;
}

test('multiword synthetic management symbols resolve identically to entry signals', () => {
  for (const [entry, followup, canonical] of [
    ['BUY Volatility 75 Index', 'close Volatility 75 Index', 'DERIV:VOLATILITY_75'],
    ['SELL Volatility 75 (1s) Index', 'move Volatility 75 (1s) Index SL to BE', 'DERIV:VOLATILITY_75_1S'],
    ['BUY Boom 1000 Index', 'close half Boom 1000 Index and make sure BE', 'DERIV:BOOM_1000'],
    ['SELL Crash 500 Index', 'cancel Crash 500 Index pending', 'DERIV:CRASH_500'],
    ['BUY Step Index', 'risk free Step Index', 'DERIV:STEP'],
    ['SELL Jump 25 Index', 'close Jump 25 Index', 'DERIV:JUMP_25'],
  ]) {
    assertEntrySymbol(entry, canonical);
    const followupPlan = buildMachinePlan({ text: followup });
    assert.equal(followupPlan.status, 'MANAGEMENT', followup);
    assert.equal(followupPlan.management.symbol?.canonical, canonical, followup);
  }
});

test('multiword synthetic management commands preserve action semantics', () => {
  assertManagementSymbol('close Volatility 75 Index', 'CLOSE', 'DERIV:VOLATILITY_75');
  assertManagementSymbol('move Volatility 75 (1s) Index SL to BE', 'MOVE_SL_TO_BE', 'DERIV:VOLATILITY_75_1S');
  assertManagementSymbol('cancel Crash 500 Index pending', 'CANCEL_PENDING', 'DERIV:CRASH_500');
  assertManagementSymbol('risk free Step Index', 'MOVE_SL_TO_BE', 'DERIV:STEP');

  const compound = assertManagementSymbol('close half Boom 1000 Index and make sure BE', 'COMPOUND', 'DERIV:BOOM_1000');
  assert.deepEqual(compound.management.actions, [
    { type: 'CLOSE_PARTIAL', fraction: 0.5 },
    { type: 'MOVE_SL_TO_BE' },
  ]);
});
