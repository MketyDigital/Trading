import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMachinePlan } from '../src/pipeline/machine_plan.js';

const cases = [
  ['SL 4280', { type: 'MOVE_SL', stopLoss: 4280 }],
  ['NEW SL 4280', { type: 'MOVE_SL', stopLoss: 4280 }],
  ['UPDATE SL 4280', { type: 'MOVE_SL', stopLoss: 4280 }],
  ['CHANGE SL TO 4280', { type: 'MOVE_SL', stopLoss: 4280 }],
  ['SL TO 4280', { type: 'MOVE_SL', stopLoss: 4280 }],
  ['STOP LOSS 4280', { type: 'MOVE_SL', stopLoss: 4280 }],
  ['TP 4350', { type: 'CHANGE_TP', takeProfit: 4350 }],
  ['TP1 4350', { type: 'CHANGE_TP', targetIndex: 1, takeProfit: 4350 }],
  ['UPDATE TP1 4350', { type: 'CHANGE_TP', targetIndex: 1, takeProfit: 4350 }],
  ['NEW TP 4350', { type: 'CHANGE_TP', takeProfit: 4350 }],
  ['CHANGE TP2 TO 4400', { type: 'CHANGE_TP', targetIndex: 2, takeProfit: 4400 }],
  ['CLOSE 25%', { type: 'CLOSE_PARTIAL', fraction: 0.25 }],
  ['CLOSE 0.01', { type: 'CLOSE_PARTIAL_VOLUME', lots: 0.01 }],
  ['REMOVE SL', { type: 'REMOVE_SL' }],
  ['REMOVE TP2', { type: 'REMOVE_TP', targetIndex: 2 }],
  ['CANCEL TP2', { type: 'REMOVE_TP', targetIndex: 2 }],
];

for (const [text, management] of cases) {
  test(`parses deterministic management command: ${text}`, () => {
    assert.deepEqual(buildMachinePlan({ text }), { status: 'MANAGEMENT', management });
  });
}

test('preserves symbol qualification on concise SL and TP management', () => {
  assert.deepEqual(buildMachinePlan({ text: 'XAUUSD SL 4280' }), {
    status: 'MANAGEMENT',
    management: { type: 'MOVE_SL', stopLoss: 4280, symbol: { canonical: 'XAUUSD', source: 'XAUUSD' } },
  });
  assert.deepEqual(buildMachinePlan({ text: 'UPDATE GOLD TP1 4350' }), {
    status: 'MANAGEMENT',
    management: { type: 'CHANGE_TP', targetIndex: 1, takeProfit: 4350, symbol: { canonical: 'XAUUSD', source: 'GOLD' } },
  });
  assert.deepEqual(buildMachinePlan({ text: '25% CLOSE GOLD' }), {
    status: 'MANAGEMENT',
    management: { type: 'CLOSE_PARTIAL', fraction: 0.25, symbol: { canonical: 'XAUUSD', source: 'GOLD' } },
  });
  assert.deepEqual(buildMachinePlan({ text: 'REMOVE GOLD SL' }), {
    status: 'MANAGEMENT',
    management: { type: 'REMOVE_SL', symbol: { canonical: 'XAUUSD', source: 'GOLD' } },
  });
});

test('does not turn informational break-even text into destructive management', () => {
  assert.equal(buildMachinePlan({ text: 'STOPPED AT BE AFTER TP2' }).status, 'NEEDS_INTERPRETATION');
});

test('still fails closed on conditional or negated concise management', () => {
  for (const text of [
    'maybe SL 4280 later',
    "don't update TP1 4350",
    'SL 4280 if price drops',
    'should we update SL 4280?',
    'remove SL if price holds',
    'close 0.01 if it reverses',
  ]) {
    assert.equal(buildMachinePlan({ text }).status, 'NEEDS_INTERPRETATION', text);
  }
});
