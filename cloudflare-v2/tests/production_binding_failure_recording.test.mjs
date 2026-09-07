import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

function account() {
  return {
    id: 'acct-a',
    workspace_id: 'ws-a',
    platform: 'mt5',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

function plan() {
  return {
    accountId: 'acct-a',
    groupId: 'group-a',
    actions: [{
      type: 'OPEN_POSITION',
      symbol: 'XAUUSD',
      lots: 0.01,
      riskPercent: 0.5,
      idempotencyKey: 'event-1:acct-a:leg-1',
      legId: 'leg-1',
    }],
  };
}

test('broker success followed by state bind failure records repair work and does not resend broker action', async () => {
  let dispatchCalls = 0;
  const repairMarkers = [];

  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'event-1',
    accountPlans: [plan()],
    brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => {
      dispatchCalls += 1;
      return {
        ok: true,
        brokerPositionId: 'position-7',
        brokerOrderId: 'order-8',
        brokerDealId: 'deal-9',
        fillPrice: 2501.25,
      };
    },
    stateBinder: async () => { throw new Error('durable object unavailable'); },
    bindingRepairRecorder: async (repair) => { repairMarkers.push(repair); },
  });

  assert.equal(dispatchCalls, 1);
  assert.equal(repairMarkers.length, 1);
  assert.deepEqual(repairMarkers[0], {
    workspaceId: 'ws-a',
    eventId: 'event-1',
    accountId: 'acct-a',
    groupId: 'group-a',
    legId: 'leg-1',
    idempotencyKey: 'event-1:acct-a:leg-1',
  });
  assert.equal(summary.accounts[0].status, 'FAILED');
  assert.equal(summary.accounts[0].actions[0].reason, 'STATE_BIND_FAILED');
});
