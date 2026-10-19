import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';

const result = {
  ok: true,
  duplicate: false,
  eventId: 'event-1',
  event: { workspace_hint: 'workspace-1' },
};

function readySimulation() {
  return {
    status: 'SIMULATED',
    accounts: [{
      accountId: 'account-1',
      status: 'READY',
      groupId: 'group-1',
      actions: [{ type: 'OPEN_POSITION', symbol: 'XAUUSD', simulated: true }],
    }],
  };
}

const tradingOn = async () => ({ ok: true, enabled: true, reason: 'TEST_TRADING_ENABLED' });

test('default real execution keeps the established disabled summary contract when persisted admin control is off', async () => {
  const execution = await runV1ProductionExecutionStage({
    env: {
      TRADING_ACCESS_ENABLED: 'false',
      BROKER_EXECUTION_ENABLED: 'false',
    },
    supabase: { from() {} },
    result,
    simulation: readySimulation(),
    tradingAccessControlResolver: tradingOn,
    brokerExecutionControlResolver: async () => ({
      ok: true,
      enabled: false,
      reason: 'TEST_OWNER_SWITCH_OFF',
    }),
  });

  assert.deepEqual(execution, {
    executionEnabled: false,
    status: 'BROKER_OWNER_SWITCH_OFF',
    accounts: [],
    succeeded: 0,
    failed: 0,
    blocked: 1,
  });
  assert.equal(Object.hasOwn(execution, 'transportMode'), false);
});

test('safe simulation explicitly exposes its synthetic transport mode', async () => {
  const execution = await runV1ProductionExecutionStage({
    env: {
      TRADING_ACCESS_ENABLED: 'false',
      BROKER_EXECUTION_ENABLED: 'false',
      TRADING_EXECUTION_TRANSPORT_MODE: 'simulation',
      SAFE_SIMULATION_EXTERNAL_TRANSPORTS: 'true',
    },
    supabase: { from() {} },
    result,
    simulation: readySimulation(),
    tradingAccessControlResolver: tradingOn,
    brokerExecutionControlResolver: async () => ({
      ok: true,
      enabled: true,
      reason: 'TEST_ENABLED',
    }),
    safeSimulationDepsFactory: async () => ({ synthetic: true }),
    bindingRepairRecorderFactory: () => ({}),
    executeProductionFn: async (_input, deps) => {
      assert.equal(deps.synthetic, true);
      return {
        executionEnabled: true,
        status: 'SUCCEEDED',
        accounts: [],
        succeeded: 1,
        failed: 0,
        blocked: 0,
      };
    },
  });

  assert.equal(execution.transportMode, 'simulation');
  assert.equal(execution.status, 'SUCCEEDED');
});


test('D1 execution stage resolves persisted runtime controls without Supabase', async () => {
  const controlReads = [];
  const enabled = async (name) => {
    controlReads.push(name);
    return { ok: true, enabled: true, reason: 'TEST_D1_CONTROL_ENABLED' };
  };
  const runtimeControls = {
    getTradingAccessEnabled: () => enabled('trading'),
    getBrokerExecutionEnabled: () => enabled('broker'),
    getLiveBrokerExecutionEnabled: () => enabled('live'),
  };
  let executionInput = null;

  const execution = await runV1ProductionExecutionStage({
    env: { TRADING_EXECUTION_TRANSPORT_MODE: 'real' },
    persistenceRuntime: { runtimeControls },
    result,
    simulation: readySimulation(),
    executionDepsFactory: async () => ({}),
    bindingRepairRecorderFactory: () => ({}),
    executeProductionFn: async (input) => {
      executionInput = input;
      return {
        executionEnabled: true,
        status: 'SUCCEEDED',
        accounts: [],
        succeeded: 1,
        failed: 0,
        blocked: 0,
      };
    },
  });

  assert.equal(execution.status, 'SUCCEEDED');
  assert.deepEqual(controlReads, ['trading', 'broker', 'live']);
  assert.equal(executionInput.liveBrokerExecutionEnabled, true);
  assert.equal(executionInput.liveBrokerExecutionControlAvailable, true);
});
