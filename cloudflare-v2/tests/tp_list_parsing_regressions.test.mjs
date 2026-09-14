import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';

function tps(text) {
  const plan = buildMachinePlan({ text });
  assert.equal(plan.status, 'READY', JSON.stringify(plan));
  return plan.intent.takeProfits;
}

test('preserves repeated unnumbered TP lines in source order', () => {
  assert.deepEqual(tps(`xauusd buy

entry 4280.12-4300.10
sl 4180.6
tp 4300.5
tp 4360.9
tp 4450.3`), [4300.5, 4360.9, 4450.3]);
});

test('preserves numbered TP targets', () => {
  assert.deepEqual(tps('BUY EURUSD 0.1200 SL 0.1100 TP1 0.1273 TP2 0.1300 TP3 0.1340'), [0.1273, 0.13, 0.134]);
});

test('parses one-line repeated TP labels separated by commas', () => {
  assert.deepEqual(tps('BUY XAUUSD 6200 SL 6100 TP 8376, TP 9353, TP 10363'), [8376, 9353, 10363]);
});

test('parses one TP label followed by a comma-separated target list', () => {
  assert.deepEqual(tps('BUY XAUUSD 2400 SL 2300 TP 2453, 6635, 8634.6'), [2453, 6635, 8634.6]);
});

test('does not split a valid thousands-grouped price into multiple targets', () => {
  assert.deepEqual(tps('BUY BTCUSD 77,000 SL 76,500 TP 77,536.637'), [77536.637]);
});

test('supports grouped prices inside a TP list without treating grouping commas as separators', () => {
  assert.deepEqual(tps('BUY BTCUSD 77,000 SL 76,500 TP 77,536.637, 78,201.24, 80,000'), [77536.637, 78201.24, 80000]);
});

test('conflicting duplicate numbered TP indexes do not silently overwrite', () => {
  const plan = buildMachinePlan({ text: 'BUY XAUUSD 4200 SL 4100 TP1 4300 TP1 4400 TP2 4500' });
  assert.notEqual(plan.status, 'READY');
});
