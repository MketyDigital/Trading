import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

function account(policy = {}) {
  return {
    id: 'acct-1',
    workspace_id: 'ws-1',
    environment: 'demo',
    is_active: true,
    execution_enabled: true,
    live_execution_enabled: false,
    safety_policy: { enabled: true, killSwitch: false, ...policy },
  };
}

function sellAction(overrides = {}) {
  return {
    type: 'OPEN_POSITION',
    legId: 'leg-1',
    idempotencyKey: 'evt-1:acct-1:leg-1',
    side: 'SELL',
    orderType: 'LIMIT',
    symbol: 'XAUUSD',
    entry: { kind: 'RANGE', min: 4273.25, max: 4279.76 },
    lots: 0.01,
    stopLoss: 4180,
    takeProfit: 4260,
    targetIndex: 1,
    ...overrides,
  };
}

async function executeWith(policy, action) {
  const dispatched = [];
  const result = await executeProductionPlan({
    workspaceId: 'ws-1',
    eventId: 'evt-1',
    brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: false,
    liveBrokerExecutionControlAvailable: true,
    accountPlans: [{ accountId: 'acct-1', groupId: 'group-1', actions: [action] }],
  }, {
    accountLoader: async () => account(policy),
    dispatchAction: async ({ action: executable }) => {
      dispatched.push(executable);
      return { ok: true };
    },
  });
  return { result, dispatched };
}

test('strict production account blocks invalid SL before broker dispatch', async () => {
  const { result, dispatched } = await executeWith({}, sellAction());
  assert.equal(dispatched.length, 0);
  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.equal(result.accounts[0].blockReason, 'INVALID_STOP_LOSS_GEOMETRY');
});

test('enabled skip-invalid SL policy removes bad SL before broker dispatch and journals the skip', async () => {
  const { result, dispatched } = await executeWith({
    invalidProtectionPolicy: 'skip_invalid',
    allowInvalidStopLossSkip: true,
  }, sellAction());
  assert.equal(result.accounts[0].status, 'SUCCEEDED');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].stopLoss, null);
  assert.equal(dispatched[0].takeProfit, 4260);
  assert.deepEqual(result.accounts[0].actions[0].skippedProtections, [
    { field: 'stopLoss', reason: 'SL_SKIPPED_INVALID_GEOMETRY' },
  ]);
});

test('enabled skip-invalid TP policy removes only invalid target before broker dispatch', async () => {
  const { result, dispatched } = await executeWith({
    invalidProtectionPolicy: 'skip_invalid',
    allowInvalidTakeProfitSkip: true,
  }, sellAction({ stopLoss: 4380, takeProfit: 4400, targetIndex: 2 }));
  assert.equal(result.accounts[0].status, 'SUCCEEDED');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].stopLoss, 4380);
  assert.equal(dispatched[0].takeProfit, null);
  assert.deepEqual(result.accounts[0].actions[0].skippedProtections, [
    { field: 'takeProfit', targetIndex: 2, reason: 'TP2_SKIPPED_INVALID_GEOMETRY' },
  ]);
});

test('kill switch remains stronger than skip-invalid protection policy', async () => {
  const { result, dispatched } = await executeWith({
    killSwitch: true,
    invalidProtectionPolicy: 'skip_invalid',
    allowInvalidStopLossSkip: true,
  }, sellAction());
  assert.equal(dispatched.length, 0);
  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.equal(result.accounts[0].reason, 'ACCOUNT_POLICY_BLOCKED');
});
