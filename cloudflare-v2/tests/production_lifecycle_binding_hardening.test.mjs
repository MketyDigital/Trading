import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';
import { buildManagementActions } from '../src/execution/position_group.js';

function account() {
  return {
    id: 'acct-a', workspace_id: 'ws-a', environment: 'demo', platform: 'ctrader',
    is_active: true, execution_enabled: true, live_execution_enabled: false,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

function plan(action) {
  return { accountId: 'acct-a', groupId: 'group-a', actions: [action] };
}

test('successful OPEN binds executed lot metadata for later symbol-aware management', async () => {
  const bindings = [];
  const action = { type: 'OPEN_POSITION', symbol: 'DERIV:VOLATILITY_75_1S', lots: 0.01, legId: 'leg-1', idempotencyKey: 'k1' };
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', brokerExecutionEnabled: true, accountPlans: [plan(action)],
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => ({ brokerPositionId: 'p1', brokerOrderId: 'o1', fillPrice: 6000, executedLots: 0.05, volumeStepLots: 0.05, minimumLots: 0.05 }),
    stateBinder: async (binding) => bindings.push(binding),
  });

  assert.equal(summary.status, 'SUCCEEDED');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].status, 'OPEN');
  assert.equal(bindings[0].executedLots, 0.05);
  assert.equal(bindings[0].volumeStepLots, 0.05);
  assert.equal(bindings[0].minimumLots, 0.05);
});

test('terminal OPEN dispatch failure binds FAILED so the staged trade cannot remain active', async () => {
  const bindings = [];
  const action = { type: 'OPEN_POSITION', symbol: 'DERIV:VOLATILITY_75_1S', lots: 0.01, legId: 'leg-1', idempotencyKey: 'k2' };
  const error = new Error('below minimum');
  error.code = 'CTRADER_VOLUME_BELOW_MINIMUM';
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-2', brokerExecutionEnabled: true, accountPlans: [plan(action)],
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => { throw error; },
    stateBinder: async (binding) => bindings.push(binding),
  });

  assert.equal(summary.status, 'FAILED');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].status, 'FAILED');
  assert.equal(bindings[0].failureCode, 'CTRADER_VOLUME_BELOW_MINIMUM');
});

test('partial close uses the persisted broker symbol volume step instead of assuming 0.01', () => {
  const group = {
    id: 'g1', symbol: 'DERIV:VOLATILITY_75_1S', entryPrice: 6000, status: 'OPEN',
    legs: [{ legId: 'leg-1', status: 'OPEN', brokerPositionId: 'p1', lots: 0.1, volumeStepLots: 0.05 }],
  };
  const actions = buildManagementActions(group, { type: 'CLOSE_PARTIAL', fraction: 0.5 });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].lots, 0.05);
});


test('reconciled broker closure binds CLOSED even for a MODIFY_POSITION management action', async () => {
  const bindings = [];
  const action = { type: 'MODIFY_POSITION', symbol: 'XAUUSD', brokerPositionId: 'p1', stopLoss: 2500, legId: 'leg-1', idempotencyKey: 'k3' };
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-3', brokerExecutionEnabled: true, accountPlans: [plan(action)],
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => ({ reconciledClosed: true, positionClosed: true, brokerPositionId: 'p1' }),
    stateBinder: async (binding) => bindings.push(binding),
  });

  assert.equal(summary.status, 'SUCCEEDED');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].status, 'CLOSED');
});

test('one successful action plus blocked sibling actions reports PARTIAL instead of false success', async () => {
  const actions = [
    { type: 'MODIFY_POSITION', symbol: 'XAUUSD', brokerPositionId: 'p1', stopLoss: 2500, legId: 'leg-1', idempotencyKey: 'partial-1' },
    { type: 'OPEN_POSITION', symbol: 'XAUUSD', side: 'BUY', lots: 0.01, legId: 'leg-2', idempotencyKey: 'partial-2' },
    { type: 'OPEN_POSITION', symbol: 'XAUUSD', side: 'BUY', lots: 0.01, legId: 'leg-3', idempotencyKey: 'partial-3' },
  ];
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-4', brokerExecutionEnabled: true,
    accountPlans: [{ accountId: 'acct-a', groupId: 'group-a', actions }],
  }, {
    accountLoader: async () => account(),
    riskMaterializer: async ({ action }) => action.legId === 'leg-1'
      ? { allowed: true, action }
      : { allowed: false, reason: 'TEST_BLOCK' },
    dispatchAction: async () => ({ brokerPositionId: 'p1' }),
    stateBinder: async () => {},
  });

  assert.equal(summary.status, 'PARTIAL');
  assert.equal(summary.partial, 1);
  assert.equal(summary.accounts[0].status, 'PARTIAL');
  assert.equal(summary.accounts[0].actions.filter((item) => item.status === 'BLOCKED').length, 2);
});
