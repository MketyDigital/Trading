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
    minimumVolumeRiskOveragePercent: 0,
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

test('balance-only broker snapshots infer BALANCE during live risk revalidation', () => {
  const result = validateProductionRiskAction({
    account: riskAccount({ riskBasis: undefined, risk_basis: undefined }),
    action: openAction(),
    brokerAccount: { balance: 10000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  });

  assert.equal(result.risk.riskBasis, 'BALANCE');
  assert.equal(result.risk.riskAmountPerLeg, 100);
  assert.equal(result.action.lots, 0.1);
});

test('persisted balance basis in account sizing config overrides available equity', () => {
  const result = validateProductionRiskAction({
    account: {
      lot_sizing_type: 'balance_risk_percent',
      lot_value: 2,
      risk_basis: 'equity',
      lot_sizing_config: { riskBasis: 'balance' },
      safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 2 },
    },
    action: openAction(),
    brokerAccount: { equity: 20000, balance: 5000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.risk.riskBasis, 'BALANCE');
  assert.equal(result.risk.riskAmountPerLeg, 100);
  assert.equal(result.action.lots, 0.1);
});

test('persisted fixed-cash risk mode uses lot value as cash budget', () => {
  const result = validateProductionRiskAction({
    account: {
      lot_sizing_type: 'risk_percent',
      lot_value: 100,
      lot_sizing_config: { riskBasis: 'balance', riskMode: 'fixed_cash' },
      safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 3 },
    },
    action: openAction(),
    brokerAccount: { equity: 20000, balance: 5000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.risk.riskBasis, 'BALANCE');
  assert.equal(result.risk.riskAmountPerLeg, 100);
  assert.equal(result.action.lots, 0.1);
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
  assert.equal(result.action.minimumVolumeFallbackAuthorized, true);
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

test('risk authority exposes only the broker-minimum excess as a policy tolerance', () => {
  const result = validateProductionRiskAction({
    account: riskAccount({ riskPercent: 0.01 }),
    action: openAction({ lots: 0.01 }),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument({ tickSize: 1, tickValuePerLot: 10, minLots: 0.1, stepLots: 0.1 }),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.policyContext.riskPercent, 0.1);
  assert.ok(Math.abs(result.policyContext.minimumVolumeRiskOveragePercent - 0.09) < 1e-12);
  assert.equal(result.action.minimumVolumeFallbackAuthorized, true);
});

test('minimum-volume tolerance for fixed monetary risk is measured against the cash budget', () => {
  const result = validateProductionRiskAction({
    account: riskAccount({ sizingMode: 'FIXED_RISK', riskAmount: 1, riskPercent: undefined }),
    action: openAction({ lots: 0.01 }),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument({ tickSize: 1, tickValuePerLot: 10, minLots: 0.1, stepLots: 0.1 }),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.risk.riskAmount, 1);
  assert.equal(result.risk.minimumFloorApplied, true);
  assert.ok(Math.abs(result.policyContext.minimumVolumeRiskOveragePercent - 0.09) < 1e-12);
  assert.equal(result.action.minimumVolumeFallbackAuthorized, true);
});

test('untrusted incoming fallback authorization is stripped from fixed-lot actions', () => {
  const result = validateProductionRiskAction({
    account: { sizingMode: 'FIXED_LOT' },
    action: openAction({ minimumVolumeFallbackAuthorized: true }),
    brokerAccount: {},
    instrument: {},
    exposure: {},
  });
  assert.equal(result.allowed, true);
  assert.equal(Object.hasOwn(result.action, 'minimumVolumeFallbackAuthorized'), false);
});

test('risk authority does not preserve caller authorization when no minimum floor was applied', () => {
  const result = validateProductionRiskAction({
    account: riskAccount(),
    action: openAction({ minimumVolumeFallbackAuthorized: true }),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.risk.minimumFloorApplied, false);
  assert.equal(Object.hasOwn(result.action, 'minimumVolumeFallbackAuthorized'), false);
});

test('production risk authority reads persisted risk mode and percent from lot sizing columns', () => {
  const result = validateProductionRiskAction({
    account: {
      lot_sizing_type: 'equity_risk_percent',
      lot_value: 1,
      risk_basis: 'equity',
    },
    action: openAction(),
    brokerAccount: { equity: 10000, balance: 10000 },
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  });
  assert.equal(result.risk.riskAmountPerLeg, 100);
  assert.equal(result.action.lots, 0.1);
});


test('fixed-cash risk fails closed when broker risk-basis equity or balance is unavailable', () => {
  assert.throws(() => validateProductionRiskAction({
    account: riskAccount({ sizingMode: 'FIXED_RISK', riskAmount: 100 }),
    action: openAction({ lots: 0.1 }),
    brokerAccount: {},
    instrument: brokerInstrument(),
    currentMarketPrice: 2500,
    exposure: {},
  }), (error) => error?.code === 'BROKER_RISK_CONTEXT_UNAVAILABLE');
});
