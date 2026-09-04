import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function account(overrides = {}) {
  return {
    id: 'acct-1',
    workspace_id: 'ws-1',
    platform: 'mt5',
    account_id: '90001',
    server_name: 'Broker-Demo',
    is_active: true,
    execution_enabled: true,
    sizingMode: 'RISK_PERCENT',
    riskPercent: 1,
    safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 2 },
    ...overrides,
  };
}

function action(overrides = {}) {
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

function context(tickValuePerLot = 1) {
  return {
    brokerAccount: { login: 90001, equity: 10000, balance: 10000 },
    catalog: [{
      platform: 'mt5',
      platformSymbol: 'XAUUSD',
      canonical: 'XAUUSD',
      tickSize: 0.01,
      tickValuePerLot,
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.01,
    }],
    marketPriceFor: async () => 2500,
  };
}

function supabaseStub() {
  return { from() { throw new Error('risk materialization must not query unrelated tables in this focused test'); } };
}

test('real production dependencies expose broker-authoritative MT5 risk materialization', async () => {
  let contextCalls = 0;
  const deps = createProductionExecutionDependencies({
    env: {
      MT5_BRIDGE_URL: 'https://mt5-bridge.example',
      MT5_BRIDGE_SECRET: 'server-only-secret',
    },
    supabase: supabaseStub(),
    workspaceId: 'ws-1',
    tradingEventId: 'event-1',
  }, {
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    mt5ContextLoader: async () => { contextCalls += 1; return context(1); },
  });

  assert.equal(typeof deps.riskMaterializer, 'function');
  const materialized = await deps.riskMaterializer({
    workspaceId: 'ws-1',
    account: account(),
    action: action({ instrument: { tickValuePerLot: 0.000001 } }),
  });

  assert.equal(contextCalls, 1);
  assert.equal(materialized.action.lots, 0.1);
  assert.deepEqual(materialized.policyRequest, {
    totalLots: 0.1,
    riskPercent: 1,
    currentDailyPnlPercent: 0,
    currentOpenRiskPercent: 0,
  });
});

test('real production MT5 risk materialization blocks when fresh broker economics reduce allowed volume', async () => {
  const deps = createProductionExecutionDependencies({
    env: {
      MT5_BRIDGE_URL: 'https://mt5-bridge.example',
      MT5_BRIDGE_SECRET: 'server-only-secret',
    },
    supabase: supabaseStub(),
    workspaceId: 'ws-1',
    tradingEventId: 'event-1',
  }, {
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    mt5ContextLoader: async () => context(2),
  });

  await assert.rejects(
    () => deps.riskMaterializer({ workspaceId: 'ws-1', account: account(), action: action() }),
    /exceed.*broker.*risk|risk.*exceed/i,
  );
});
