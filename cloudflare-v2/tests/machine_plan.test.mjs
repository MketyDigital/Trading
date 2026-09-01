import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';

test('parses a three-TP market signal into canonical execution intent', () => {
  const plan = buildMachinePlan({ text: 'BUY XAUUSD 2526 SL 2518 TP 2530 2535 2545' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.side, 'BUY');
  assert.equal(plan.intent.orderType, 'MARKET');
  assert.equal(plan.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(plan.intent.entry, { kind: 'PRICE', value: 2526 });
  assert.equal(plan.intent.stopLoss, 2518);
  assert.deepEqual(plan.intent.takeProfits, [2530, 2535, 2545]);
});

test('parses entry ranges and common GOLD aliases', () => {
  const plan = buildMachinePlan({ text: 'SELL GOLD 2525-2528 SL 2535 TP1 2520 TP2 2515 TP3 2500' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(plan.intent.entry, { kind: 'RANGE', min: 2525, max: 2528 });
  assert.deepEqual(plan.intent.takeProfits, [2520, 2515, 2500]);
});

test('parses pending orders', () => {
  const plan = buildMachinePlan({ text: 'BUY LIMIT EURUSD 1.1600 SL 1.1570 TP 1.1650' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.orderType, 'LIMIT');
  assert.equal(plan.intent.entry.value, 1.16);
});

test('classifies management instructions without inventing a new trade', () => {
  assert.deepEqual(buildMachinePlan({ text: 'MOVE SL TO BE' }), { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } });
  assert.deepEqual(buildMachinePlan({ text: 'CLOSE HALF' }), { status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 } });
  assert.deepEqual(buildMachinePlan({ text: 'CANCEL PENDING' }), { status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING' } });
});

test('fast signal stays executable but explicitly incomplete for later reconciliation', () => {
  const plan = buildMachinePlan({ text: 'BUY GOLD NOW' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.fastEntry, true);
  assert.equal(plan.intent.incomplete, true);
  assert.equal(plan.intent.symbol.canonical, 'XAUUSD');
});

test('ambiguous commentary fails closed for machine execution', () => {
  const plan = buildMachinePlan({ text: 'Gold looking interesting here, maybe buys later' });
  assert.equal(plan.status, 'NEEDS_INTERPRETATION');
});
