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
  assert.equal(plan.risk.totalLots, 0.3);
  assert.deepEqual(plan.group.legs.map((leg) => leg.lots), [0.1, 0.1, 0.1]);
  assert.deepEqual(plan.actions.map((action) => action.takeProfit), [2510, 2520, 2530]);
});

test('fixed-risk sizing applies the cash risk budget independently to each TP leg', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'LIMIT', symbol: { canonical: 'XAUUSD' }, entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    takeProfits: [2510, 2520, 2530],
  }, {
    account: { equity: 10000, sizingMode: 'FIXED_RISK', riskAmount: 100 },
    instrument,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.risk.riskAmountPerLeg, 100);
  assert.equal(plan.risk.totalRiskAmount, 300);
  assert.equal(plan.risk.totalLots, 0.3);
  assert.deepEqual(plan.actions.map((action) => action.lots), [0.1, 0.1, 0.1]);
});

test('explicit fixed monetary risk overrides percentage sizing during planning', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' }, entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    takeProfits: [2510],
  }, { account: { equity: 10000, sizingMode: 'EQUITY_RISK_PERCENT', riskPercent: 5, riskAmount: 100 }, instrument });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.risk.riskAmount, 100);
  assert.equal(plan.risk.totalLots, 0.1);
});

test('marks only newly planned pending order legs for future lifecycle tracking', () => {
  const pending = buildExecutionPlan({
    side: 'BUY', orderType: 'LIMIT', symbol: { canonical: 'EURUSD' }, entry: { kind: 'PRICE', value: 1.08 },
    stopLoss: 1.07, takeProfits: [1.09],
  }, { account: { equity: 10000, sizingMode: 'FIXED_LOTS', fixedLots: 0.1 }, instrument });
  const market = buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'EURUSD' }, entry: { kind: 'MARKET' },
    stopLoss: 1.07, takeProfits: [1.09],
  }, { account: { equity: 10000, sizingMode: 'FIXED_LOTS', fixedLots: 0.1 }, instrument, currentMarketPrice: 1.08 });
  assert.equal(pending.group.legs[0].lifecycleTrackingEnabled, true);
  assert.equal(market.group.legs[0].lifecycleTrackingEnabled, undefined);
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

test('default protection policy skips invalid SL independently and opens a fixed-lot trade', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'LIMIT', symbol:{canonical:'XAUUSD'}, entry:{kind:'RANGE',min:4273.25,max:4279.76}, stopLoss:4180, takeProfits:[], incomplete:true,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.01,safetyPolicy:{enabled:true}},
    instrument,
    currentMarketPrice:4275,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.group.stopLoss, null);
  assert.equal(plan.actions.length, 1);
  assert.ok(plan.protectionIssues.some((item) => item.field === 'stopLoss' && item.code === 'SL_INVALID_GEOMETRY'));
  assert.deepEqual(plan.protectionSkips.map((item) => item.field), ['stopLoss']);
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

test('skipping a passed first target preserves the remaining logical TP indices', () => {
  const plan = buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'VOLATILITY_75'}, entry:{kind:'MARKET'}, stopLoss:4200, takeProfits:[4250, 4280, 4290], incomplete:false,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.05,safetyPolicy:{enabled:true}},
    instrument:{minLots:0.05,maxLots:100,stepLots:0.05},
    currentMarketPrice:4275,
  });
  assert.equal(plan.status, 'READY');
  assert.deepEqual(plan.actions.map((action) => [action.targetIndex, action.takeProfit, action.stopLoss]), [
    [2, 4280, 4200], [3, 4290, 4200],
  ]);
  assert.deepEqual(plan.group.legs.map((leg) => leg.logicalTargetIndex), [2, 3]);
  assert.deepEqual(plan.logicalTakeProfits, [null, 4280, 4290]);
});

test('default protection policy skips invalid target while preserving valid targets and SL', () => {
  const plan = buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'XAUUSD'}, entry:{kind:'MARKET'}, stopLoss:4260, takeProfits:[4250, 4280, 4290], incomplete:false,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.01,safetyPolicy:{enabled:true}},
    instrument,
    currentMarketPrice:4275,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.group.stopLoss, 4260);
  assert.deepEqual(plan.actions.map((action) => action.takeProfit), [4280, 4290]);
  assert.deepEqual(plan.protectionSkips.map((item) => item.targetIndex), [1]);
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


test('fixed lots below broker minimum fail closed instead of silently increasing exposure', () => {
  assert.throws(() => buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'DERIV:VOLATILITY_75_1S'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[], fastEntry:true, incomplete:true,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.01,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.05,maxLots:100,stepLots:0.05},
    currentMarketPrice:6000,
  }), (error) => error?.code === 'FIXED_LOTS_BELOW_BROKER_MINIMUM');
});

test('fixed lots are floored to the broker step without exceeding the configured preference', () => {
  const plan = buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'BTCUSD'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[], fastEntry:true, incomplete:true,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:0.137,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.01,maxLots:10,stepLots:0.01},
    currentMarketPrice:100000,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].lots, 0.13);
});

test('fixed lots above broker maximum are capped at the broker executable maximum', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'MARKET', symbol:{canonical:'US500'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[], fastEntry:true, incomplete:true,
  }, {
    account:{sizingMode:'FIXED_LOTS',fixedLots:25,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.1,maxLots:10,stepLots:0.1},
    currentMarketPrice:7000,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].lots, 10);
});


test('adaptive sizing scales the user reference lot by percent per target', () => {
  const plan = buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'XAUUSD'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[2510,2520], fastEntry:true, incomplete:false,
  }, {
    account:{sizingMode:'ADAPTIVE_PERCENT',referenceLots:1,adaptivePercent:25,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    currentMarketPrice:2500,
  });
  assert.equal(plan.status, 'READY');
  assert.deepEqual(plan.actions.map((action) => action.lots), [0.25,0.25]);
});

test('adaptive sizing raises a scaled lot to the broker minimum when that symbol requires more', () => {
  const plan = buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'DERIV:VOLATILITY_75'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[], fastEntry:true, incomplete:true,
  }, {
    account:{sizingMode:'ADAPTIVE_PERCENT',referenceLots:1,adaptivePercent:25,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.5,maxLots:100,stepLots:0.5},
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].lots, 0.5);
});

test('adaptive sizing floors to broker step and never exceeds the scaled preference unless minimum requires it', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'MARKET', symbol:{canonical:'BTCUSD'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[], fastEntry:true, incomplete:true,
  }, {
    account:{sizingMode:'ADAPTIVE_PERCENT',referenceLots:1,adaptivePercent:33,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.1,maxLots:10,stepLots:0.1},
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].lots, 0.3);
});

test('adaptive sizing caps at the broker executable maximum', () => {
  const plan = buildExecutionPlan({
    side:'SELL', orderType:'MARKET', symbol:{canonical:'US500'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[], fastEntry:true, incomplete:true,
  }, {
    account:{sizingMode:'ADAPTIVE_PERCENT',referenceLots:20,adaptivePercent:75,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.1,maxLots:10,stepLots:0.1},
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].lots, 10);
});

test('adaptive sizing still obeys aggregate account max-lots safety policy', () => {
  const plan = buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'XAUUSD'},
    entry:{kind:'MARKET'}, stopLoss:null, takeProfits:[2510,2520,2530],
  }, {
    account:{
      sizingMode:'ADAPTIVE_PERCENT',referenceLots:1,adaptivePercent:25,
      safetyPolicy:{enabled:true,killSwitch:false,maxLotsPerTrade:0.5},
    },
    instrument:{minLots:0.01,maxLots:100,stepLots:0.01},
    currentMarketPrice:2500,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.deepEqual(plan.actions, []);
});


test('symbol-equivalent uses broker-derived per-target lot on a fast signal without SL or TP', () => {
  const plan = buildExecutionPlan({
    side:'BUY',orderType:'MARKET',symbol:{canonical:'DERIV:VOLATILITY_75'},entry:{kind:'MARKET'},stopLoss:null,takeProfits:[],fastEntry:true,incomplete:true,
  }, {
    account:{sizingMode:'SYMBOL_EQUIVALENT',referenceLots:0.9,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.01,maxLots:100,stepLots:0.01,symbolEquivalentLots:0.3},
  });
  assert.equal(plan.status,'READY');
  assert.equal(plan.actions[0].lots,0.3);
});

test('balance-percent uses broker-derived capped lot on a fast signal without SL or TP', () => {
  const plan = buildExecutionPlan({
    side:'SELL',orderType:'MARKET',symbol:{canonical:'BTCUSD'},entry:{kind:'MARKET'},stopLoss:null,takeProfits:[],fastEntry:true,incomplete:true,
  }, {
    account:{sizingMode:'BALANCE_PERCENT',referenceLots:1,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.01,maxLots:100,stepLots:0.01,balancePercentLots:0.25},
  });
  assert.equal(plan.status,'READY');
  assert.equal(plan.actions[0].lots,0.25);
});

test('per-target allocation preserves current one-sized-lot-per-TP behavior', () => {
  const plan = buildExecutionPlan({
    side:'BUY',orderType:'MARKET',symbol:{canonical:'XAUUSD'},entry:{kind:'MARKET'},stopLoss:2400,takeProfits:[2510,2520,2530],
  }, {
    account:{sizingMode:'SYMBOL_EQUIVALENT',referenceLots:0.09,safetyPolicy:{enabled:true,killSwitch:false}},
    instrument:{minLots:0.01,maxLots:100,stepLots:0.01,symbolEquivalentLots:0.09},
    currentMarketPrice:2500,
  });
  assert.deepEqual(plan.actions.map((action)=>action.lots),[0.09,0.09,0.09]);
});


test('fixed monetary risk override is checked against actual risk percent for account policy', () => {
  const plan = buildExecutionPlan({
    side:'BUY', orderType:'MARKET', symbol:{canonical:'XAUUSD'}, entry:{kind:'PRICE',value:2500},
    stopLoss:2490, takeProfits:[2510],
  }, {
    account:{equity:10000,sizingMode:'EQUITY_RISK_PERCENT',riskPercent:1,riskAmount:500,
      safetyPolicy:{enabled:true,killSwitch:false,maxRiskPercent:2}},
    instrument,
  });
  assert.equal(plan.status,'BLOCKED');
  assert.ok(plan.policy.reasons.includes('MAX_RISK_EXCEEDED'));
});


test('execution plan creates any number of risk-sized TP actions with 1% risk per leg', () => {
  for (const targetCount of [1, 2, 4, 5, 7]) {
    const takeProfits = Array.from({ length: targetCount }, (_, index) => 2510 + (index * 10));
    const plan = buildExecutionPlan({
      side: 'BUY',
      orderType: 'MARKET',
      symbol: { canonical: 'XAUUSD' },
      entry: { kind: 'PRICE', value: 2500 },
      stopLoss: 2490,
      takeProfits,
      fastEntry: false,
    }, {
      account: { equity: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 },
      instrument,
    });

    assert.equal(plan.status, 'READY', `plan status for ${targetCount} targets`);
    assert.equal(plan.risk.riskAmountPerLeg, 100);
    assert.equal(plan.risk.totalRiskAmount, 100 * targetCount);
    assert.equal(plan.risk.totalLots, 0.1 * targetCount);
    assert.equal(plan.group.legs.length, targetCount);
    assert.equal(plan.actions.length, targetCount);
    assert.deepEqual(plan.actions.map((action) => action.takeProfit), takeProfits);
    assert.deepEqual(plan.actions.map((action) => action.lots), Array(targetCount).fill(0.1));
  }
});


test('maxRiskPercent is per TP leg while maxOpenRiskPercent checks aggregate group risk', () => {
  const intent = {
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    takeProfits: [2510, 2520, 2530], fastEntry: false,
  };
  const perLegAllowed = buildExecutionPlan(intent, {
    account: { equity: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1,
      safetyPolicy: { enabled: true, killSwitch: false, maxRiskPercent: 1.1, maxOpenRiskPercent: 3.1 } },
    instrument,
  });
  assert.equal(perLegAllowed.status, 'READY');
  assert.equal(perLegAllowed.risk.totalRiskAmount, 300);

  const aggregateBlocked = buildExecutionPlan(intent, {
    account: { equity: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1,
      safetyPolicy: { enabled: true, killSwitch: false, maxRiskPercent: 1.1, maxOpenRiskPercent: 2.9 } },
    instrument,
  });
  assert.equal(aggregateBlocked.status, 'BLOCKED');
  assert.ok(aggregateBlocked.policy.reasons.includes('OPEN_RISK_LIMIT'));
});

test('risk-sized signal with no TP uses one entry leg and one per-leg risk budget', () => {
  const plan = buildExecutionPlan({
    side: 'BUY',
    orderType: 'MARKET',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 },
    stopLoss: 2490,
    takeProfits: [],
    fastEntry: false,
  }, {
    account: { equity: 10000, sizingMode: 'RISK_PERCENT', riskPercent: 1 },
    instrument,
  });

  assert.equal(plan.status, 'READY');
  assert.equal(plan.risk.riskAmountPerLeg, 100);
  assert.equal(plan.risk.totalRiskAmount, 100);
  assert.equal(plan.group.legs.length, 1);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].lots, 0.1);
  assert.equal(plan.actions[0].takeProfit, null);
});


test('risk sizing counts only retained executable TP targets after invalid targets are skipped', () => {
  const plan = buildExecutionPlan({
    side: 'SELL',
    orderType: 'MARKET',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 },
    stopLoss: 2510,
    takeProfits: [2490, 2480, 2520, 2470],
    incomplete: false,
  }, {
    account: {
      equity: 10000,
      sizingMode: 'RISK_PERCENT',
      riskPercent: 1,
      safetyPolicy: {
        enabled: true,
        invalidProtectionPolicy: 'skip_invalid',
        allowInvalidTakeProfitSkip: true,
      },
    },
    instrument,
  });

  assert.equal(plan.status, 'READY');
  assert.deepEqual(plan.actions.map((action) => action.takeProfit), [2490, 2480, 2470]);
  assert.deepEqual(plan.actions.map((action) => action.targetIndex), [1, 2, 4]);
  assert.equal(plan.risk.riskAmountPerLeg, 100);
  assert.equal(plan.risk.totalRiskAmount, 300);
  assert.equal(plan.risk.totalLots, 0.3);
  assert.equal(plan.group.legs.length, 3);
  assert.equal(plan.actions.length, 3);
  assert.deepEqual(plan.actions.map((action) => action.lots), [0.1, 0.1, 0.1]);
  assert.deepEqual(plan.protectionSkips, [{
    field: 'takeProfits',
    targetIndex: 3,
    code: 'TP3_SKIPPED_INVALID_GEOMETRY',
    value: 2520,
  }]);
});


test('fixed-lot normalization handles tiny scientific broker steps without drift', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'MICRO' },
    entry: { kind: 'MARKET' }, stopLoss: null, takeProfits: [], fastEntry: true, incomplete: true,
  }, {
    account: { sizingMode: 'FIXED_LOTS', fixedLots: 0.0000003, safetyPolicy: { enabled: true, killSwitch: false } },
    instrument: { minLots: 0.0000001, maxLots: 0.000001, stepLots: 0.0000001 },
    currentMarketPrice: 100,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].lots, 0.0000003);
});

test('fixed-lot normalization does not round a genuinely fractional broker step upward', () => {
  const plan = buildExecutionPlan({
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'MICRO' },
    entry: { kind: 'MARKET' }, stopLoss: null, takeProfits: [], fastEntry: true, incomplete: true,
  }, {
    account: { sizingMode: 'FIXED_LOTS', fixedLots: 0.00000039, safetyPolicy: { enabled: true, killSwitch: false } },
    instrument: { minLots: 0.0000001, maxLots: 0.000001, stepLots: 0.0000001 },
    currentMarketPrice: 100,
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].lots, 0.0000003);
});
