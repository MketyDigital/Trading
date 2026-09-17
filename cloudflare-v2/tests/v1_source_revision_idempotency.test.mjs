import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';

function readySimulation(stopLoss) {
  return {
    status: 'SIMULATED',
    executionEnabled: false,
    accounts: [{
      accountId: 'acct-demo',
      groupId: 'group-1',
      status: 'READY',
      actions: [{
        type: 'MODIFY_POSITION',
        legId: 'leg-1',
        brokerPositionId: 'position-1',
        symbol: 'XAUUSD',
        stopLoss,
        simulated: true,
      }],
    }],
  };
}

async function plannedKey(revisionKey, stopLoss = 4390) {
  let plans;
  const result = {
    ok: true,
    duplicate: false,
    revision: true,
    eventId: 'evt-parent',
    revisionId: `rev-${revisionKey.slice(-4)}`,
    event: {
      workspace_hint: 'ws-1',
      external_event_id: 'telegram:-100123:317',
      metadata: { source_revision_key: revisionKey },
    },
  };

  await runV1ProductionExecutionStage({
    env: {},
    supabase: {},
    result,
    simulation: readySimulation(stopLoss),
    executionDepsFactory: async () => ({ stateBinder: async () => {} }),
    bindingRepairRecorderFactory: () => async () => {},
    tradingAccessControlResolver: async () => ({ ok: true, enabled: true }),
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
    liveBrokerExecutionControlResolver: async () => ({ ok: true, enabled: false }),
    executeProductionFn: async ({ accountPlans }) => {
      plans = structuredClone(accountPlans);
      return { status: 'SUCCEEDED' };
    },
  });

  return plans[0].actions[0].idempotencyKey;
}

test('different revisions of the same Telegram message receive different broker idempotency keys', async () => {
  const first = await plannedKey(`sha256:${'a'.repeat(64)}`, 4390);
  const second = await plannedKey(`sha256:${'b'.repeat(64)}`, 4400);

  assert.notEqual(first, second);
  assert.match(first, /sha256:/);
  assert.match(second, /sha256:/);
});

test('the same source revision produces the same broker idempotency key on retry', async () => {
  const revisionKey = `sha256:${'c'.repeat(64)}`;
  const first = await plannedKey(revisionKey, 4390);
  const replay = await plannedKey(revisionKey, 4390);

  assert.equal(first, replay);
});
