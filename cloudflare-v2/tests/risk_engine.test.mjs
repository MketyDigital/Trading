import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiskPlan } from '../src/risk/risk_engine.js';

test('sizes total lots from account risk using tick metadata then splits across targets', () => {
  const plan = calculateRiskPlan({
    equity: 10000,
    riskPercent: 1,
    entry: 2500,
    stopLoss: 2490,
    targetCount: 3,
    instrument: {
      tickSize: 0.01,
      tickValuePerLot: 1,
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.01,
    },
  });

  assert.equal(plan.riskAmount, 100);
  assert.equal(plan.lossPerLotAtStop, 1000);
  assert.equal(plan.totalLots, 0.1);
  assert.deepEqual(plan.legLots, [0.04, 0.03, 0.03]);
});

test('accepts adapter-computed loss-per-lot for non-simple instrument models', () => {
  const plan = calculateRiskPlan({
    balance: 5000,
    riskPercent: 2,
    targetCount: 2,
    instrument: {
      lossPerLotAtStop: 250,
      minLots: 0.01,
      maxLots: 10,
      stepLots: 0.01,
    },
  });

  assert.equal(plan.riskAmount, 100);
  assert.equal(plan.totalLots, 0.4);
  assert.deepEqual(plan.legLots, [0.2, 0.2]);
});

test('fails closed when no reliable loss model is available', () => {
  assert.throws(() => calculateRiskPlan({
    balance: 1000,
    riskPercent: 1,
    entry: 10,
    stopLoss: 9,
    targetCount: 1,
    instrument: { stepLots: 0.01 },
  }), /loss model/i);
});

test('fails closed when safe risk-sized volume is below broker minimum instead of rounding risk upward', () => {
  assert.throws(() => calculateRiskPlan({
    balance: 1000,
    riskAmount: 1,
    entry: 100,
    stopLoss: 90,
    targetCount: 1,
    instrument: {
      tickSize: 1,
      tickValuePerLot: 10,
      minLots: 0.1,
      maxLots: 10,
      stepLots: 0.1,
    },
  }), /below broker minimum/i);
});
