import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMachinePlan } from '../src/pipeline/machine_plan.js';

test('grouped prices inside one TP list remain distinct complete targets', () => {
  const plan = buildMachinePlan({
    text: 'BUY BTCUSD 77,000 SL 76,500 TP 77,536.637, 78,201.24, 80,000',
  });

  assert.equal(plan.status, 'READY', JSON.stringify(plan));
  assert.deepEqual(plan.intent.takeProfits, [77536.637, 78201.24, 80000]);
});

test('conflicting duplicate numbered TP indexes fail closed instead of silently overwriting', () => {
  const plan = buildMachinePlan({
    text: 'BUY XAUUSD 4200 SL 4100 TP1 4300 TP1 4400 TP2 4500',
  });

  assert.notEqual(plan.status, 'READY', JSON.stringify(plan));
});
