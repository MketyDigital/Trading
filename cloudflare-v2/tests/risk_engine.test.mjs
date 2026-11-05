import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiskPlan } from '../src/risk/risk_engine.js';

test('applies risk budget per TP leg and reports aggregate risk', () => {
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

  assert.equal(plan.riskAmountPerLeg, 100);
  assert.equal(plan.totalRiskAmount, 300);
  assert.equal(plan.lossPerLotAtStop, 1000);
  assert.equal(plan.lotsPerLeg, 0.1);
  assert.equal(plan.totalLots, 0.3);
  assert.deepEqual(plan.legLots, [0.1, 0.1, 0.1]);
  assert.equal(plan.estimatedRiskPerLeg, 100);
  assert.equal(plan.estimatedRisk, 300);
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
  assert.equal(plan.totalRiskAmount, 200);
  assert.equal(plan.totalLots, 0.8);
  assert.deepEqual(plan.legLots, [0.4, 0.4]);
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

test('floors below-budget risk volume to broker minimum and reports actual excess risk', () => {
  const args = {
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
  };
  const plan = calculateRiskPlan(args);
  assert.equal(plan.lotsPerLeg, 0.1);
  assert.equal(plan.minimumFloorApplied, true);
  assert.equal(plan.estimatedRiskPerLeg, 10);
  assert.equal(plan.riskOverBudgetPerLeg, 9);

  assert.throws(() => calculateRiskPlan({ ...args, minimumLotPolicy: 'REJECT' }), /below broker minimum/i);
});

test('balance-based percentage risk uses balance rather than equity', () => {
  const plan = calculateRiskPlan({
    equity: 20000,
    balance: 5000,
    riskPercent: 2,
    riskBasis: 'BALANCE',
    entry: 100,
    stopLoss: 90,
    targetCount: 1,
    instrument: {
      tickSize: 1,
      tickValuePerLot: 10,
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.01,
    },
  });
  assert.equal(plan.riskAmount, 100);
  assert.equal(plan.riskBasis, 'BALANCE');
  assert.equal(plan.totalLots, 1);
});

test('floors broker maximum volume to the supported step instead of rounding above max', () => {
  const plan = calculateRiskPlan({
    riskAmount: 100,
    entry: 100,
    stopLoss: 90,
    targetCount: 1,
    instrument: {
      lossPerLotAtStop: 100,
      minLots: 0.1,
      maxLots: 0.25,
      stepLots: 0.1,
    },
  });

  assert.equal(plan.lotsPerLeg, 0.2);
  assert.ok(plan.lotsPerLeg <= 0.25);
});

test('supports scientific-notation volume steps without invalid decimal precision', () => {
  const plan = calculateRiskPlan({
    riskAmount: 0.00001,
    entry: 100,
    stopLoss: 90,
    targetCount: 1,
    instrument: {
      lossPerLotAtStop: 1,
      minLots: 1e-7,
      maxLots: 1,
      stepLots: 1e-7,
    },
  });
  assert.equal(plan.lotsPerLeg, 0.00001);
  assert.equal(plan.legLots[0], 0.00001);
});


test('supports arbitrary dynamic TP counts with risk budget independently applied per leg', () => {
  for (const targetCount of [1, 2, 4, 5, 7]) {
    const plan = calculateRiskPlan({
      equity: 10000,
      riskPercent: 1,
      entry: 2500,
      stopLoss: 2490,
      targetCount,
      instrument: {
        tickSize: 0.01,
        tickValuePerLot: 1,
        minLots: 0.01,
        maxLots: 100,
        stepLots: 0.01,
      },
    });

    assert.equal(plan.riskAmountPerLeg, 100, `risk budget per leg for ${targetCount} targets`);
    assert.equal(plan.totalRiskAmount, 100 * targetCount, `aggregate risk for ${targetCount} targets`);
    assert.equal(plan.lotsPerLeg, 0.1);
    assert.equal(plan.totalLots, 0.1 * targetCount);
    assert.equal(plan.legLots.length, targetCount);
    assert.deepEqual(plan.legLots, Array(targetCount).fill(0.1));
    assert.equal(plan.estimatedRiskPerLeg, 100);
    assert.equal(plan.estimatedRisk, 100 * targetCount);
  }
});


test('risk lot step indexing handles tiny scientific steps without floating-point drift', () => {
  const plan = calculateRiskPlan({
    riskAmount: 0.0000003,
    entry: 100,
    stopLoss: 90,
    targetCount: 3,
    instrument: {
      lossPerLotAtStop: 1,
      minLots: 0.0000001,
      maxLots: 0.00001,
      stepLots: 0.0000001,
    },
  });
  assert.equal(plan.lotsPerLeg, 0.0000003);
  assert.equal(plan.totalLots, 0.0000009);
  assert.deepEqual(plan.legLots, [0.0000003, 0.0000003, 0.0000003]);
});
