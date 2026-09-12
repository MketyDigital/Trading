import test from 'node:test';
import assert from 'node:assert/strict';

import { createSafeSimulationExecutionDependencies } from '../src/execution/safe_simulation_execution_deps.js';
import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';

function account(platform = 'mt5') {
  return {
    id: 'acct-1',
    workspace_id: 'ws-1',
    platform,
    account_id: platform === 'ctrader' ? '123456' : '90001',
    server_name: platform === 'ctrader' ? 'demo' : 'Broker-Demo',
    credential_ciphertext: 'synthetic-envelope',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

function querySupabase(row) {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: row, error: null }),
      };
    },
  };
}

test('safe simulation MT5 dependency never reaches network and returns production-shaped broker binding', async () => {
  let networkCalls = 0;
  const row = account('mt5');
  const deps = createSafeSimulationExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'test-master' },
    supabase: querySupabase(row),
    workspaceId: 'ws-1',
    tradingEventId: 'evt-1',
  }, {
    decryptCredentialsFn: async () => ({ bridgeUrl: 'https://dummy.invalid', bridgeSecret: 'dummy' }),
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    fetchFn: async () => { networkCalls += 1; throw new Error('network forbidden'); },
  });

  const result = await deps.dispatchAction({
    workspaceId: 'ws-1',
    eventId: 'evt-1',
    account: row,
    action: { type: 'OPEN_POSITION', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'evt-1:acct-1:1' },
  });

  assert.equal(networkCalls, 0);
  assert.equal(result.ok, true);
  assert.match(result.brokerPositionId, /^sim-mt5-/);
  assert.equal(result.transportMode, 'simulation');
});

test('safe simulation cTrader dependency never builds a real transport', async () => {
  let networkCalls = 0;
  const row = account('ctrader');
  const deps = createSafeSimulationExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'test-master', CTRADER_LIVE_TRADING_ENABLED: 'true' },
    supabase: querySupabase(row),
    workspaceId: 'ws-1',
    tradingEventId: 'evt-1',
  }, {
    decryptCredentialsFn: async () => ({ clientId: 'dummy', clientSecret: 'dummy', accessToken: 'dummy' }),
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    fetchFn: async () => { networkCalls += 1; throw new Error('network forbidden'); },
  });

  const result = await deps.dispatchAction({
    workspaceId: 'ws-1',
    eventId: 'evt-1',
    account: row,
    action: { type: 'OPEN_POSITION', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'evt-1:acct-1:1' },
  });

  assert.equal(networkCalls, 0);
  assert.equal(result.ok, true);
  assert.match(result.brokerPositionId, /^sim-ctrader-/);
  assert.equal(result.transportMode, 'simulation');
});

test('execution transport mode is selected only from server env, never request/result/simulation payload', async () => {
  let realFactoryCalls = 0;
  let simulationFactoryCalls = 0;
  const common = {
    supabase: {},
    result: { ok: true, eventId: 'evt-1', event: { workspace_hint: 'ws-1' } },
    simulation: {
      status: 'SIMULATED',
      transportMode: 'real',
      accounts: [{ accountId: 'acct-1', status: 'READY', actions: [{ type: 'OPEN_POSITION', idempotencyKey: 'k1' }] }],
    },
    executionDepsFactory: async () => { realFactoryCalls += 1; return {}; },
    safeSimulationDepsFactory: async () => { simulationFactoryCalls += 1; return {}; },
    bindingRepairRecorderFactory: () => null,
    executeProductionFn: async (_plan, deps) => ({ ok: true, deps }),
    tradingAccessControlResolver: async () => ({ ok: true, enabled: true }),
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
  };

  await runV1ProductionExecutionStage({
    ...common,
    env: { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true', TRADING_EXECUTION_TRANSPORT_MODE: 'simulation' },
  });
  assert.equal(simulationFactoryCalls, 1);
  assert.equal(realFactoryCalls, 0);

  await runV1ProductionExecutionStage({
    ...common,
    env: { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
  });
  assert.equal(realFactoryCalls, 1);
  assert.equal(simulationFactoryCalls, 1);
});
