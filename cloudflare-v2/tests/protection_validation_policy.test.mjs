import test from 'node:test';
import assert from 'node:assert/strict';

import { applyProtectionValidationPolicy } from '../src/pipeline/protection_validation_policy.js';

function sellAction(overrides = {}) {
  return {
    type: 'OPEN_POSITION',
    side: 'SELL',
    symbol: 'XAUUSD',
    orderType: 'LIMIT',
    entry: { kind: 'RANGE', min: 4273.25, max: 4279.76 },
    stopLoss: 4180,
    takeProfit: 4260,
    targetIndex: 1,
    lots: 0.01,
    ...overrides,
  };
}

test('strict default rejects an invalid SELL stop without mutating the action', () => {
  const action = sellAction();
  const result = applyProtectionValidationPolicy(action, {});
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INVALID_STOP_LOSS_GEOMETRY');
  assert.deepEqual(action, sellAction());
});

test('skip_invalid can omit only an invalid SL while preserving a valid TP', () => {
  const result = applyProtectionValidationPolicy(sellAction(), {
    invalidProtectionPolicy: 'skip_invalid',
    allowInvalidStopLossSkip: true,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.action.stopLoss, null);
  assert.equal(result.action.takeProfit, 4260);
  assert.deepEqual(result.skipped, [{ field: 'stopLoss', reason: 'SL_SKIPPED_INVALID_GEOMETRY' }]);
});

test('skip_invalid can omit an invalid TP while preserving valid SL', () => {
  const result = applyProtectionValidationPolicy(sellAction({ stopLoss: 4380, takeProfit: 4400, targetIndex: 2 }), {
    invalidProtectionPolicy: 'skip_invalid',
    allowInvalidTakeProfitSkip: true,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.action.stopLoss, 4380);
  assert.equal(result.action.takeProfit, null);
  assert.deepEqual(result.skipped, [{ field: 'takeProfit', targetIndex: 2, reason: 'TP2_SKIPPED_INVALID_GEOMETRY' }]);
});

test('skip policy remains strict unless the matching per-field switch is enabled', () => {
  const result = applyProtectionValidationPolicy(sellAction(), {
    invalidProtectionPolicy: 'skip_invalid',
    allowInvalidStopLossSkip: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'INVALID_STOP_LOSS_GEOMETRY');
});

test('invalid or missing entry semantics are never made skippable by protection policy', () => {
  const result = applyProtectionValidationPolicy(sellAction({ entry: { kind: 'MARKET' } }), {
    invalidProtectionPolicy: 'skip_invalid',
    allowInvalidStopLossSkip: true,
    allowInvalidTakeProfitSkip: true,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.action.entry.kind, 'MARKET');
  assert.equal(result.skipped.length, 0);
});
