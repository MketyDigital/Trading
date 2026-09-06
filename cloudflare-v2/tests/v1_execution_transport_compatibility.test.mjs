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

test('default real execution keeps the established disabled summary contract', async () => {
  const execution = await runV1ProductionExecutionStage({
    env: {
      TRADING_ACCESS_ENABLED: 'true',
      BROKER_EXECUTION_ENABLED: 'false',
    },
    result,
    simulation: readySimulation(),
  });

  assert.deepEqual(execution, {
    executionEnabled: false,
    status: 'BROKER_EXECUTION_DISABLED',
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
      TRADING_ACCESS_ENABLED: 'true',
      BROKER_EXECUTION_ENABLED: 'true',
      TRADING_EXECUTION_TRANSPORT_MODE: 'simulation',
      SAFE_SIMULATION_EXTERNAL_TRANSPORTS: 'true',
    },
    supabase: { from() {} },
    result,
    simulation: readySimulation(),
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
