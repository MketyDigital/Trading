import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

function account(overrides = {}) {
  return {
    id: 'acct-a',
    workspace_id: 'ws-a',
    platform: 'mt5',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
    ...overrides,
  };
}

function openAction(overrides = {}) {
  return {
    type: 'OPEN_POSITION',
    symbol: 'XAUUSD',
    lots: 0.01,
    riskPercent: 0.5,
    idempotencyKey: 'evt-1:acct-a:leg:1',
    legId: 'leg-1',
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    accountId: 'acct-a',
    groupId: 'group-a',
    actions: [openAction()],
    ...overrides,
  };
}

test('broker master fuse fails before account, dispatch, or state dependencies are touched', async () => {
  const touched = [];
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-1',
    accountPlans: [plan()],
    brokerExecutionEnabled: false,
  }, {
    accountLoader: async () => { touched.push('account'); throw new Error('must not load'); },
    dispatchAction: async () => { touched.push('dispatch'); throw new Error('must not dispatch'); },
    stateBinder: async () => { touched.push('state'); throw new Error('must not bind'); },
  });

  assert.equal(summary.executionEnabled, false);
  assert.equal(summary.status, 'BROKER_EXECUTION_DISABLED');
  assert.equal(summary.succeeded, 0);
  assert.equal(summary.failed, 0);
  assert.equal(summary.blocked, 1);
  assert.deepEqual(touched, []);
});

test('exact workspace, active account, and account execution flag are revalidated before dispatch', async () => {
  const cases = [
    { name: 'workspace mismatch', row: account({ workspace_id: 'ws-b' }), reason: 'ACCOUNT_WORKSPACE_MISMATCH' },
    { name: 'inactive account', row: account({ is_active: false }), reason: 'ACCOUNT_INACTIVE' },
    { name: 'execution disabled', row: account({ execution_enabled: false }), reason: 'ACCOUNT_EXECUTION_DISABLED' },
  ];

  for (const item of cases) {
    let dispatchCalls = 0;
    const summary = await executeProductionPlan({
      workspaceId: 'ws-a', eventId: 'evt-1', accountPlans: [plan()], brokerExecutionEnabled: true,
    }, {
      accountLoader: async () => item.row,
      dispatchAction: async () => { dispatchCalls += 1; return { ok: true }; },
      stateBinder: async () => {},
    });

    assert.equal(summary.executionEnabled, true, item.name);
    assert.equal(summary.accounts[0].status, 'BLOCKED', item.name);
    assert.equal(summary.accounts[0].reason, item.reason, item.name);
    assert.equal(dispatchCalls, 0, item.name);
  }
});

test('account kill switch blocks both new risk and risk-reducing management before dispatch', async () => {
  let dispatchCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-1',
    accountPlans: [plan({
      actions: [
        openAction(),
        { type: 'CLOSE_PARTIAL', symbol: 'XAUUSD', fraction: 0.5, idempotencyKey: 'evt-1:acct-a:close', legId: 'leg-1' },
      ],
    })],
    brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account({ safety_policy: { enabled: true, killSwitch: true } }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true }; },
    stateBinder: async () => {},
  });

  assert.equal(summary.accounts[0].status, 'BLOCKED');
  assert.equal(summary.accounts[0].reason, 'ACCOUNT_POLICY_BLOCKED');
  assert.deepEqual(summary.accounts[0].policy.reasons, ['KILL_SWITCH']);
  assert.equal(dispatchCalls, 0);
});

test('drawdown policy blocks new risk but still allows risk-reducing management when kill switch is off', async () => {
  const seen = [];
  const safety = {
    enabled: true,
    killSwitch: false,
    maxDailyLossPercent: 3,
  };

  const openSummary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', brokerExecutionEnabled: true,
    accountPlans: [plan({
      currentDailyPnlPercent: -4,
      actions: [openAction()],
    })],
  }, {
    accountLoader: async () => account({ safety_policy: safety }),
    dispatchAction: async ({ action }) => { seen.push(action.type); return { ok: true }; },
    stateBinder: async () => {},
  });
  assert.equal(openSummary.accounts[0].status, 'BLOCKED');
  assert.deepEqual(openSummary.accounts[0].policy.reasons, ['DAILY_LOSS_LIMIT']);

  const managementSummary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-2', brokerExecutionEnabled: true,
    accountPlans: [plan({
      currentDailyPnlPercent: -4,
      actions: [{ type: 'CLOSE_PARTIAL', symbol: 'XAUUSD', fraction: 0.5, idempotencyKey: 'evt-2:acct-a:close', legId: 'leg-1' }],
    })],
  }, {
    accountLoader: async () => account({ safety_policy: safety }),
    dispatchAction: async ({ action }) => { seen.push(action.type); return { ok: true }; },
    stateBinder: async () => {},
  });
  assert.equal(managementSummary.accounts[0].status, 'SUCCEEDED');
  assert.deepEqual(seen, ['CLOSE_PARTIAL']);
});

test('one account dispatch failure cannot block a successful sibling account', async () => {
  const bound = [];
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-1',
    brokerExecutionEnabled: true,
    accountPlans: [
      plan({ accountId: 'acct-a', groupId: 'group-a', actions: [openAction()] }),
      plan({
        accountId: 'acct-b',
        groupId: 'group-b',
        actions: [openAction({ idempotencyKey: 'evt-1:acct-b:leg:1', legId: 'leg-b' })],
      }),
    ],
  }, {
    accountLoader: async (_workspaceId, accountId) => account({ id: accountId }),
    dispatchAction: async ({ account: row, action }) => {
      if (row.id === 'acct-a') throw new Error('broker unavailable');
      return { ok: true, brokerPositionId: 'position-b', brokerOrderId: 'order-b', fillPrice: 2500.5, action };
    },
    stateBinder: async (binding) => { bound.push(binding); },
  });

  assert.equal(summary.executionEnabled, true);
  assert.equal(summary.status, 'PARTIAL_FAILURE');
  assert.equal(summary.failed, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.accounts[0].status, 'FAILED');
  assert.equal(summary.accounts[1].status, 'SUCCEEDED');
  assert.equal(bound.length, 1);
  assert.equal(bound[0].accountId, 'acct-b');
  assert.equal(bound[0].groupId, 'group-b');
  assert.equal(bound[0].legId, 'leg-b');
  assert.equal(bound[0].brokerPositionId, 'position-b');
});
