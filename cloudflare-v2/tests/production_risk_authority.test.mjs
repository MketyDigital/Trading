import test from 'node:test';
import assert from 'node:assert/strict';

import { validateProductionRiskAction } from '../src/execution/production_risk_authority.js';

function riskAccount(overrides = {}) {
  return {
    id: 'acct-1',
    workspace_id: 'ws-1',
    sizingMode: 'RISK_PERCENT',
    riskPercent: 1,
    safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 2 },
    ...overrides,
  };
}

function openAction(overrides = {}) {
  return {
    type: 'OPEN_POSITION',
    side: 'BUY',
    orderType: 'MARKET',
    symbol: 'XAUUSD',
    entry: { kind: 'PRICE', value: 2500 },
    lots: 0.1,
    stopLoss: 2490,
    takeProfit: 2510,
    idempotencyKey: 'evt-1:acct-1:leg-1',
    ...overrides,
  };
}

function brokerInstrument(overrides = {}) {
  return {
    canonical: 'XAUUSD',
    tickSize: 0.01,
    tickValuePerLot: 1,
    minLots: 0.01,
    maxLots: 100,
    stepLots: 0.01,
    ...overrides,
  };
}

test('risk-percent OPEN is accepted only when current broker account and symbol economics support the planned lots', () => {
  const result = validateProductionRiskAction({
    account: riskAccount(),
    action: openAction(),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: { currentDailyPnlPercent: -0.5, currentOpenRiskPercent: 0.25 },
  });

  assert.equal(result.action.lots, 0.1);
  assert.deepEqual(result.policyContext, {
    totalLots: 0.1,
    riskPercent: 1,
    currentDailyPnlPercent: -0.5,
    currentOpenRiskPercent: 0.25,
  });
  assert.equal(result.risk.totalLots, 0.1);
});

test('configured BALANCE risk basis is honored during live broker revalidation', () => {
  const result = validateProductionRiskAction({
    account: riskAccount({ riskPercent: 2, riskBasis: 'BALANCE' }),
    action: openAction({ lots: 0.1 }),
    brokerAccount: { equity: 10000, balance: 5000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  });

  assert.equal(result.risk.riskBasis, 'BALANCE');
  assert.equal(result.risk.riskAmount, 100);
  assert.equal(result.risk.totalLots, 0.1);
});

test('explicit fixed monetary risk overrides percentage mode during broker revalidation', () => {
  const result = validateProductionRiskAction({
    account: riskAccount({ riskPercent: 5, riskAmount: 100 }),
    action: openAction({ lots: 0.1 }),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.risk.riskAmount, 100);
  assert.equal(result.risk.totalLots, 0.1);
});

test('changed broker economics rematerialize risk lots downward rather than reject stale planned lots', () => {
  const result = validateProductionRiskAction({
    account: riskAccount(),
    action: openAction({ lots: 0.1 }),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument({ tickValuePerLot: 2 }),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.action.lots, 0.05);
  assert.equal(result.risk.lotsPerLeg, 0.05);
});

test('risk authority floors to broker minimum and exposes actual excess cash risk', () => {
  const result = validateProductionRiskAction({
    account: riskAccount({ riskPercent: 0.01 }),
    action: openAction({ lots: 0.01 }),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument({ tickSize: 1, tickValuePerLot: 10, minLots: 0.1, stepLots: 0.1 }),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.action.lots, 0.1);
  assert.equal(result.risk.minimumFloorApplied, true);
  assert.equal(result.risk.riskOverBudgetPerLeg, 9);
});

test('risk-percent OPEN fails closed when current broker loss-at-stop economics are unavailable', () => {
  assert.throws(() => validateProductionRiskAction({
    account: riskAccount(),
    action: openAction(),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: { canonical: 'XAUUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 },
    currentMarketPrice: 2500,
    exposure: {},
  }), /loss model|risk context|broker.*economics/i);
});

test('live policy context reports broker-calculated cash risk as a percentage', () => {
  const result = validateProductionRiskAction({
    account: riskAccount({ sizingMode:'EQUITY_RISK_PERCENT', riskPercent:1, riskAmount:500,
      safety_policy:{enabled:true,killSwitch:false,maxRiskPercent:2} }),
    action: openAction({ lots:0.1 }),
    brokerAccount:{equity:10000,balance:10000},
    instrument:brokerInstrument(),
    currentMarketPrice:2500,
    exposure:{currentOpenRiskPercent:0},
  });
  assert.equal(result.policyContext.riskPercent, 5);
});
