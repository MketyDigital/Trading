import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionPlan } from '../src/execution/execution_plan.js';

const instrument = { tickSize: 0.01, tickValuePerLot: 1, minLots: 0.01, maxLots: 100, stepLots: 0.01 };

test('builds risk-sized three-leg plan from one canonical intent', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' }, entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    takeProfits: [2510, 2520, 2530], fastEntry: false,
  }, { account: { equity: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 }, instrument });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.risk.totalLots, 0.1);
  assert.deepEqual(plan.group.legs.map((leg) => leg.lots), [0.04, 0.03, 0.03]);
  assert.deepEqual(plan.actions.map((action) => action.takeProfit), [2510, 2520, 2530]);
});

test('preserves stable leg identity on every open-position action', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' }, entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    takeProfits: [2510, 2520, 2530], fastEntry: false,
  }, { account: { equity: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 }, instrument, groupId: 'group-1' });
  assert.deepEqual(plan.group.legs.map((leg) => leg.legId), ['leg-1', 'leg-2', 'leg-3']);
  assert.deepEqual(plan.actions.map((action) => action.legId), ['leg-1', 'leg-2', 'leg-3']);
  assert.deepEqual(plan.actions.map((action) => action.idempotencyKey), ['group-1:leg:1', 'group-1:leg:2', 'group-1:leg:3']);
});

test('uses worst-case entry from BUY range when calculating stop risk', () => {
  const plan = buildExecutionPlan({ side:'BUY', orderType:'LIMIT', symbol:{canonical:'XAUUSD'}, entry:{kind:'RANGE',min:2525,max:2528}, stopLoss:2518, takeProfits:[2535] }, { account:{balance:10000,sizingMode:'RISK_PERCENT',riskPercent:1}, instrument });
  assert.equal(plan.riskEntryPrice, 2528);
});

test('uses worst-case entry from SELL range when calculating stop risk', () => {
  const plan = buildExecutionPlan({ side:'SELL', orderType:'LIMIT', symbol:{canonical:'XAUUSD'}, entry:{kind:'RANGE',min:2525,max:2528}, stopLoss:2535, takeProfits:[2515] }, { account:{balance:10000,sizingMode:'RISK_PERCENT',riskPercent:1}, instrument });
  assert.equal(plan.riskEntryPrice, 2525);
});

test('requires a current market price to risk-size MARKET/NOW entry without explicit price', () => {
  assert.throws(() => buildExecutionPlan({ side:'BUY',orderType:'MARKET',symbol:{canonical:'XAUUSD'},entry:{kind:'MARKET'},stopLoss:2490,takeProfits:[2510],fastEntry:true }, { account:{balance:10000,sizingMode:'RISK_PERCENT',riskPercent:1},instrument }), /current market price/i);
});

test('treats configured fixed lot as per-target lot size', () => {
  const plan = buildExecutionPlan({ side:'SELL',orderType:'MARKET',symbol:{canonical:'EURUSD'},entry:{kind:'MARKET'},stopLoss:1.09,takeProfits:[1.08,1.07,1.06] }, { account:{sizingMode:'FIXED_LOTS',fixedLots:0.10},instrument:{...instrument,stepLots:0.01},currentMarketPrice:1.085,groupId:'fixed-group' });
  assert.equal(plan.risk, null);
  assert.deepEqual(plan.group.legs.map((leg) => leg.lots), [0.10, 0.10, 0.10]);
  assert.deepEqual(plan.actions.map((action) => action.lots), [0.10, 0.10, 0.10]);
  assert.deepEqual(plan.actions.map((action) => action.legId), ['leg-1', 'leg-2', 'leg-3']);
});

test('fixed-lot safety policy evaluates aggregate exposure across all target legs', () => {
  const plan = buildExecutionPlan({ side:'BUY',orderType:'MARKET',symbol:{canonical:'XAUUSD'},entry:{kind:'MARKET'},stopLoss:null,takeProfits:[2510,2520,2530] }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.10,safetyPolicy:{enabled:true,killSwitch:false,maxLotsPerTrade:0.20}},
    instrument,
    currentMarketPrice:2500,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.deepEqual(plan.actions, []);
});

test('supports fixed-lot enterprise policies without running risk math', () => {
  const plan = buildExecutionPlan({ side:'SELL',orderType:'MARKET',symbol:{canonical:'EURUSD'},entry:{kind:'MARKET'},stopLoss:1.09,takeProfits:[1.08,1.07] }, { account:{sizingMode:'FIXED_LOTS',fixedLots:0.06},instrument:{...instrument,stepLots:0.01},currentMarketPrice:1.085 });
  assert.equal(plan.risk, null);
  assert.deepEqual(plan.group.legs.map((leg) => leg.lots), [0.06, 0.06]);
});

test('returns BLOCKED before emitting broker actions when account safety policy rejects new risk', () => {
  const plan = buildExecutionPlan({ side:'BUY',orderType:'MARKET',symbol:{canonical:'XAUUSD'},entry:{kind:'PRICE',value:2500},stopLoss:2490,takeProfits:[2510] }, {
    account:{ equity:10000,sizingMode:'RISK_PERCENT',riskPercent:1, safetyPolicy:{enabled:true,killSwitch:false,allowedSymbols:['EURUSD'],maxLotsPerTrade:1,maxRiskPercent:2} },
    instrument,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.deepEqual(plan.actions, []);
  assert.ok(plan.policy.reasons.includes('SYMBOL_NOT_ALLOWED'));
});

test('strict protection policy blocks invalid SELL stop geometry before broker actions', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'LIMIT', symbol:{canonical:'XAUUSD'}, entry:{kind:'RANGE',min:4273.25,max:4279.76}, stopLoss:4180, takeProfits:[], incomplete:true,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.01,safetyPolicy:{enabled:true}},
    instrument,
    currentMarketPrice:4275,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.reason, 'INVALID_PROTECTION');
  assert.deepEqual(plan.actions, []);
  assert.ok(plan.protectionIssues.some((item) => item.field === 'stopLoss' && item.code === 'SL_INVALID_GEOMETRY'));
});

test('skip-invalid policy opens fixed-lot trade without invalid SELL stop and records skip reason', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'LIMIT', symbol:{canonical:'XAUUSD'}, entry:{kind:'RANGE',min:4273.25,max:4279.76}, stopLoss:4180, takeProfits:[], incomplete:true,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.01,safetyPolicy:{enabled:true,invalidProtectionPolicy:'skip_invalid',allowInvalidStopLossSkip:true}},
    instrument,
    currentMarketPrice:4275,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.group.stopLoss, null);
  assert.equal(plan.actions[0].stopLoss, null);
  assert.deepEqual(plan.protectionSkips, [{ field:'stopLoss', code:'SL_SKIPPED_INVALID_GEOMETRY', value:4180 }]);
});

test('skip-invalid policy removes only invalid target while preserving valid SELL targets', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'MARKET', symbol:{canonical:'XAUUSD'}, entry:{kind:'MARKET'}, stopLoss:4300, takeProfits:[4250, 4220, 4350], incomplete:false,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.01,safetyPolicy:{enabled:true,invalidProtectionPolicy:'skip_invalid',allowInvalidTakeProfitSkip:true}},
    instrument,
    currentMarketPrice:4275,
  });
  assert.equal(plan.status, 'READY');
  assert.deepEqual(plan.actions.map((action) => action.takeProfit), [4250, 4220]);
  assert.deepEqual(plan.protectionSkips, [{ field:'takeProfits', targetIndex:3, code:'TP3_SKIPPED_INVALID_GEOMETRY', value:4350 }]);
});

test('risk-based sizing stays blocked when the only stop is invalid even under skip policy', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'LIMIT', symbol:{canonical:'XAUUSD'}, entry:{kind:'PRICE',value:4275}, stopLoss:4180, takeProfits:[4250], incomplete:false,
  }, {
    account:{balance:10000,sizingMode:'RISK_PERCENT',riskPercent:1,safetyPolicy:{enabled:true,invalidProtectionPolicy:'skip_invalid',allowInvalidStopLossSkip:true}},
    instrument,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.reason, 'INVALID_PROTECTION_REQUIRED_FOR_RISK_SIZING');
  assert.deepEqual(plan.actions, []);
});
