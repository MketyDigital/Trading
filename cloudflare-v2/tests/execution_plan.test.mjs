import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionPlan } from '../src/execution/execution_plan.js';

const instrument = {
  tickSize: 0.01,
  tickValuePerLot: 1,
  minLots: 0.01,
  maxLots: 100,
  stepLots: 0.01,
};

test('builds risk-sized three-leg plan from one canonical intent', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    takeProfits: [2510, 2520, 2530], fastEntry: false,
  }, {
    account: { equity: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 },
    instrument,
  });

  assert.equal(plan.risk.totalLots, 0.1);
  assert.deepEqual(plan.group.legs.map((leg) => leg.lots), [0.04, 0.03, 0.03]);
  assert.deepEqual(plan.actions.map((action) => action.takeProfit), [2510, 2520, 2530]);
  assert.ok(plan.actions.every((action) => action.type === 'OPEN_POSITION'));
});

test('uses worst-case entry from BUY range when calculating stop risk', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'LIMIT', symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'RANGE', min: 2525, max: 2528 }, stopLoss: 2518,
    takeProfits: [2535], fastEntry: false,
  }, {
    account: { balance: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 },
    instrument,
  });
  assert.equal(plan.riskEntryPrice, 2528);
});

test('uses worst-case entry from SELL range when calculating stop risk', () => {
  const plan = buildExecutionPlan({
    side: 'SELL', orderType: 'LIMIT', symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'RANGE', min: 2525, max: 2528 }, stopLoss: 2535,
    takeProfits: [2515], fastEntry: false,
  }, {
    account: { balance: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 },
    instrument,
  });
  assert.equal(plan.riskEntryPrice, 2525);
});

test('requires a current market price to risk-size MARKET/NOW entry without explicit price', () => {
  assert.throws(() => buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'MARKET' }, stopLoss: 2490, takeProfits: [2510], fastEntry: true,
  }, {
    account: { balance: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 },
    instrument,
  }), /current market price/i);
});

test('supports fixed-lot enterprise policies without running risk math', () => {
  const plan = buildExecutionPlan({
    side: 'SELL', orderType: 'MARKET', symbol: { canonical: 'EURUSD' },
    entry: { kind: 'MARKET' }, stopLoss: 1.09, takeProfits: [1.08, 1.07], fastEntry: false,
  }, {
    account: { sizingMode: 'FIXED_LOTS', fixedLots: 0.06 },
    instrument: { ...instrument, stepLots: 0.01 },
    currentMarketPrice: 1.085,
  });
  assert.equal(plan.risk, null);
  assert.deepEqual(plan.group.legs.map((leg) => leg.lots), [0.03, 0.03]);
});
