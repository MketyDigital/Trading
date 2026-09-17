import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

function account() {
  return {
    id: 'acct-a',
    workspace_id: 'ws-a',
    platform: 'mt5',
    environment: 'demo',
    is_active: true,
    execution_enabled: true,
    live_execution_enabled: false,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

test('broker success with null fillPrice never materializes fillPrice as zero', async () => {
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-null-fill',
    brokerExecutionEnabled: true,
    accountPlans: [{
      accountId: 'acct-a',
      groupId: 'group-a',
      actions: [{
        type: 'OPEN_POSITION',
        symbol: 'XAUUSD',
        lots: 0.01,
        idempotencyKey: 'evt-null-fill:acct-a:leg:1',
        legId: 'leg-1',
      }],
    }],
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => ({
      ok: true,
      brokerPositionId: 'position-a',
      fillPrice: null,
    }),
    stateBinder: async () => {},
  });

  assert.equal(summary.accounts[0].status, 'SUCCEEDED');
  assert.equal('fillPrice' in summary.accounts[0].actions[0], false);
});
