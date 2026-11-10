import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps_unified.js';

function account(overrides = {}) {
  return {
    id: 'acct-mt5-risk', workspace_id: 'ws-a', platform: 'mt5', provider_mode: 'mt5_connector',
    account_id: '50123456', server_name: 'Broker-Demo', environment: 'demo',
    sizing_mode: 'RISK_PERCENT', risk_percent: 1,
    provider_config: {
      status: 'connected',
      symbolCatalog: [{
        platformSymbol: 'XAUUSD.r', canonical: 'XAUUSD', aliases: ['GOLD'], tradable: true,
        minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, tickValueLoss: 1.2, digits: 2,
      }],
    },
    credential_ciphertext: 'connector-cipher', is_active: true, execution_enabled: true,
    safety_policy: { killSwitch: false },
    ...overrides,
  };
}

function connectorFetch({ bid = 2500.4, ask = 2500.5 } = {}, requests = []) {
  return async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer control-secret');
    if (url.endsWith('/v1/mt5-connections/acct-mt5-risk')) {
      return new Response(JSON.stringify({
        ok: true, online: true, accountRowId: 'acct-mt5-risk',
        identity: {
          accountNumber: '50123456', serverName: 'Broker-Demo', isLive: false,
          symbols: [{
            platformSymbol: 'XAUUSD.r', canonical: 'XAUUSD', aliases: ['GOLD'], tradable: true,
            minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, tickValueLoss: 1.2, digits: 2,
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.match(url, /\/v1\/mt5-context\/acct-mt5-risk\?symbol=XAUUSD\.r(?:&includeExposure=true)?$/);
    return new Response(JSON.stringify({
      ok: true, accountRowId: 'acct-mt5-risk',
      context: {
        account: { accountNumber: '50123456', serverName: 'Broker-Demo', balance: 10000, equity: 10000 },
        symbol: {
          platformSymbol: 'XAUUSD.r', minLots: 0.01, maxLots: 100, stepLots: 0.01,
          tickSize: 0.01, tickValueLoss: 1.2, tickValue: 1.2, digits: 2,
        },
        tick: { ask, bid, last: (ask + bid) / 2 },
        exposure: { currentDailyPnlPercent: -1.5, currentOpenRiskPercent: 4.25 },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

function depsWithFetch(fetchFn) {
  return createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master' },
    supabase: { from() { throw new Error('unexpected DB query'); } },
    workspaceId: 'ws-a', tradingEventId: 'event-1',
  }, {
    decryptCredentialsFn: async (kind) => {
      assert.equal(kind, 'mt5_connector');
      return { gatewayUrl: 'https://gateway.example:25345', controlSecret: 'control-secret' };
    },
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    fetchFn,
  });
}

test('risk-percent MT5 connector revalidates against fresh account equity, symbol economics and tick over outbound gateway', async () => {
  const requests = [];
  const deps = depsWithFetch(connectorFetch({}, requests));

  const action = {
    type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET', lots: 0.01,
    stopLoss: 2499.5, idempotencyKey: 'event-1:acct-mt5-risk:1',
  };
  const result = await deps.riskMaterializer({ workspaceId: 'ws-a', account: account(), action });

  assert.equal(result.allowed, true);
  assert.equal(result.action.lots, 0.83);
  assert.equal(result.risk != null, true);
  assert.equal(result.risk.riskAmount, 100);
  assert.equal(requests.length, 2);
});

test('MT5 connector fixed-cash risk uses the monetary budget, not the percentage alias', async () => {
  const requests = [];
  const deps = depsWithFetch(connectorFetch({}, requests));
  const action = {
    type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET', lots: 0.01,
    stopLoss: 2499.5, idempotencyKey: 'event-fixed-cash:acct-mt5-risk:1',
  };
  const result = await deps.riskMaterializer({
    workspaceId: 'ws-a',
    account: account({
      sizing_mode: 'RISK_PERCENT', lot_sizing_type: 'risk_percent', lot_value: 50,
      risk_percent: undefined, lot_sizing_config: { riskBasis: 'balance', riskMode: 'fixed_cash' },
    }),
    action,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.risk.riskAmountPerLeg, 50);
  assert.equal(result.risk.riskBasis, 'BALANCE');
  assert.equal(result.action.lots, 0.41);
  assert.ok(result.policyContext.riskPercent < 1);
  assert.equal(requests.length, 2);
});

test('MT5 BUY break-even uses fresh bid and blocks while bid is below entry', async () => {
  const requests = [];
  const deps = depsWithFetch(connectorFetch({ bid: 4305.9, ask: 4306.1 }, requests));
  const action = {
    type: 'MODIFY_POSITION', managementType: 'MOVE_SL_TO_BE', brokerPositionId: '5700448668',
    symbol: 'GOLD', side: 'BUY', entryPrice: 4306.45, stopLoss: 4306.45,
    idempotencyKey: 'event-2:acct-mt5-risk:be',
  };

  const result = await deps.riskMaterializer({ workspaceId: 'ws-a', account: account(), action });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'BREAK_EVEN_NOT_ELIGIBLE_YET');
  assert.equal(requests.length, 2);
});

test('MT5 SELL break-even uses fresh ask and blocks while ask is above entry', async () => {
  const deps = depsWithFetch(connectorFetch({ bid: 4306.6, ask: 4306.8 }));
  const action = {
    type: 'MODIFY_POSITION', managementType: 'MOVE_SL_TO_BE', brokerPositionId: '5700448668',
    symbol: 'XAUUSD', side: 'SELL', entryPrice: 4306.45, stopLoss: 4306.45,
    idempotencyKey: 'event-3:acct-mt5-risk:be',
  };

  const result = await deps.riskMaterializer({ workspaceId: 'ws-a', account: account(), action });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'BREAK_EVEN_NOT_ELIGIBLE_YET');
});

test('MT5 break-even becomes eligible once the stop-trigger side has crossed entry', async () => {
  const deps = depsWithFetch(connectorFetch({ bid: 4306.5, ask: 4306.7 }));
  const action = {
    type: 'MODIFY_POSITION', managementType: 'MOVE_SL_TO_BE', brokerPositionId: '5700448668',
    symbol: 'XAUUSD', side: 'BUY', entryPrice: 4306.45, stopLoss: 4306.45,
    idempotencyKey: 'event-4:acct-mt5-risk:be',
  };

  const result = await deps.riskMaterializer({ workspaceId: 'ws-a', account: account({ sizing_mode: 'FIXED_LOTS' }), action });
  assert.equal(result.allowed, true);
});

test('owner opt-in uses zero exposure only for a genuine transient provider error', async () => {
  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master' },
    supabase: { from() { throw new Error('unexpected DB query'); } },
    workspaceId: 'ws-a', tradingEventId: 'event-1',
  }, {
    exposureLoader: async () => { const error = new Error('temporary timeout'); error.code = 'ETIMEDOUT'; throw error; },
    decryptCredentialsFn: async () => ({ gatewayUrl: 'https://gateway.example:25345', controlSecret: 'control-secret' }),
    fetchFn: connectorFetch(),
  });
  const action = { type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET', lots: 0.01, stopLoss: 2499.5 };
  const result = await deps.riskMaterializer({
    workspaceId: 'ws-a',
    account: account({ safety_policy: { maxOpenRiskPercent: 20, allowTransientExposureZeroFallback: true } }),
    action,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.policyContext.currentOpenRiskPercent, 0);
});

test('opt-in never masks an unimplemented exposure provider or non-transient failure', async () => {
  const action = { type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET', lots: 0.01, stopLoss: 2499.5 };
  const configured = account({ safety_policy: { maxOpenRiskPercent: 20, allowTransientExposureZeroFallback: true } });
  await assert.rejects(
    depsWithFetch(async (url, options) => { const response = await connectorFetch()(url, options); if (url.includes('includeExposure=true')) { const body = await response.json(); delete body.context.exposure; return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); } return response; }).riskMaterializer({ workspaceId: 'ws-a', account: configured, action }),
    /MT5 connector exposure implementation unavailable/,
  );
  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master' },
    supabase: { from() { throw new Error('unexpected DB query'); } },
    workspaceId: 'ws-a', tradingEventId: 'event-1',
  }, { exposureLoader: async () => { const error = new Error('bad credentials'); error.code = 'EACCES'; throw error; } });
  await assert.rejects(
    deps.riskMaterializer({ workspaceId: 'ws-a', account: configured, action }),
    /bad credentials/,
  );
});

test('live MT5 connector obtains authoritative exposure from the gateway before risk sizing', async () => {
  const requests = [];
  const deps = depsWithFetch(connectorFetch({}, requests));
  const action = {
    type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET',
    lots: 0.01, stopLoss: 2499.5,
  };
  const result = await deps.riskMaterializer({
    workspaceId: 'ws-a',
    account: account({ safety_policy: { maxOpenRiskPercent: 20, maxDailyLossPercent: 50 } }),
    action,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.policyContext.currentOpenRiskPercent, 4.25);
  assert.equal(result.policyContext.currentDailyPnlPercent, -1.5);
  assert.equal(requests.some(({ url }) => url.includes('includeExposure=true')), true);
});

test('external exposure override rejects absent, coerced, nonfinite and negative risk values before broker calls', async () => {
  const cases = [
    null,
    {},
    { currentDailyPnlPercent: null, currentOpenRiskPercent: 0 },
    { currentDailyPnlPercent: 0, currentOpenRiskPercent: null },
    { currentDailyPnlPercent: '', currentOpenRiskPercent: 0 },
    { currentDailyPnlPercent: false, currentOpenRiskPercent: 0 },
    { currentDailyPnlPercent: '0', currentOpenRiskPercent: 0 },
    { currentDailyPnlPercent: 0, currentOpenRiskPercent: -1 },
    { currentDailyPnlPercent: Number.NaN, currentOpenRiskPercent: 0 },
  ];
  for (const exposure of cases) {
    let brokerCalls = 0;
    const deps = createProductionExecutionDependencies({
      env: { TRADING_MASTER_KEY: 'master' },
      supabase: { from() { throw new Error('unexpected DB query'); } },
      workspaceId: 'ws-a', tradingEventId: 'event-1',
    }, {
      exposureLoader: async () => exposure,
      fetchFn: async () => { brokerCalls += 1; throw new Error('unexpected broker call'); },
    });
    await assert.rejects(
      deps.riskMaterializer({
        workspaceId: 'ws-a',
        account: account({ safety_policy: { maxOpenRiskPercent: 20 } }),
        action: { type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET', lots: 0.01, stopLoss: 2499.5 },
      }),
      (error) => error.code === 'BROKER_EXPOSURE_CONTEXT_INCOMPLETE',
    );
    assert.equal(brokerCalls, 0);
  }
});

test('external exposure override retains finite signed daily PnL and nonnegative open risk', async () => {
  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master' },
    supabase: { from() { throw new Error('unexpected DB query'); } },
    workspaceId: 'ws-a', tradingEventId: 'event-1',
  }, {
    exposureLoader: async () => ({ currentDailyPnlPercent: -1.5, currentOpenRiskPercent: 4.25 }),
    decryptCredentialsFn: async () => ({ gatewayUrl: 'https://gateway.example:25345', controlSecret: 'control-secret' }),
    fetchFn: connectorFetch(),
  });
  const result = await deps.riskMaterializer({
    workspaceId: 'ws-a',
    account: account({ safety_policy: { maxOpenRiskPercent: 20, maxDailyLossPercent: 50 } }),
    action: { type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET', lots: 0.01, stopLoss: 2499.5 },
  });
  assert.equal(result.allowed, true);
  assert.equal(result.policyContext.currentDailyPnlPercent, -1.5);
  assert.equal(result.policyContext.currentOpenRiskPercent, 4.25);
});
