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

test('broker master fuse fails before account, authority, dispatch, or state dependencies are touched', async () => {
  const touched = [];
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-1',
    accountPlans: [plan()],
    brokerExecutionEnabled: false,
  }, {
    accountLoader: async () => { touched.push('account'); throw new Error('must not load'); },
    authorityLoader: async () => { touched.push('authority'); throw new Error('must not load authority'); },
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

test('one execution batch loads a repeated follower/account configuration once', async () => {
  let accountLoads = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', brokerExecutionEnabled: true,
    accountPlans: [
      plan({ actions: [openAction({ legId: 'leg-1' })] }),
      plan({ actions: [openAction({ legId: 'leg-2', idempotencyKey: 'evt-1:acct-a:leg:2' })] }),
    ],
  }, {
    accountLoader: async () => { accountLoads += 1; return account(); },
    dispatchAction: async () => ({ ok: true, brokerPositionId: 'position-1' }),
    stateBinder: async () => {},
  });
  assert.equal(summary.succeeded, 2);
  assert.equal(accountLoads, 1);
});

test('fresh authorization flags overlay the loaded account without discarding its execution configuration', async () => {
  let dispatchedAccount;
  const loaded = account({
    live_execution_enabled: true,
    provider_config: { symbolCatalog: [{ symbol: 'XAUUSD' }] },
    credential_ciphertext: 'ciphertext',
    safety_policy: { enabled: true, killSwitch: false },
  });
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: true, accountPlans: [plan()],
  }, {
    accountLoader: async () => loaded,
    authorityLoader: async () => ({ account: {
      id: 'acct-a', workspace_id: 'ws-a', is_active: true, execution_enabled: true, live_execution_enabled: true,
      safety_policy: { enabled: true, killSwitch: false, maxOpenPositions: 7 },
    } }),
    dispatchAction: async ({ account: current }) => { dispatchedAccount = current; return { ok: true, brokerPositionId: 'p-1' }; },
    stateBinder: async () => {},
  });

  assert.equal(summary.accounts[0].status, 'SUCCEEDED');
  assert.deepEqual(dispatchedAccount.provider_config, loaded.provider_config);
  assert.equal(dispatchedAccount.credential_ciphertext, 'ciphertext');
  assert.equal(dispatchedAccount.live_execution_enabled, true);
  assert.deepEqual(dispatchedAccount.safety_policy, { enabled: true, killSwitch: false, maxOpenPositions: 7 });
});

test('supersession opens the replacement side after a failed close, then retries only the old position', async () => {
  const dispatched = [];
  const closeKeys = [];
  let closeAttempts = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-reversal', brokerExecutionEnabled: true,
    accountPlans: [plan({
      groupId: 'new-buy-group',
      supersessionCloseActionCount: 1,
      actions: [
        { type: 'CLOSE_POSITION', symbol: 'EURJPY', lots: 0.01, legId: 'old-sell-leg', executionGroupId: 'old-sell-group', idempotencyKey: 'evt-reversal:old-close' },
        openAction({ idempotencyKey: 'evt-reversal:new-buy', legId: 'new-buy-leg' }),
      ],
    })],
  }, {
    accountLoader: async () => account(),
    dispatchAction: async ({ groupId, action }) => {
      dispatched.push({ groupId, type: action.type });
      if (action.type === 'CLOSE_POSITION') {
        closeAttempts += 1;
        closeKeys.push(action.idempotencyKey);
        return closeAttempts === 1 ? { ok: false, code: 'CLOSE_REJECTED' } : { ok: true, reconciledClosed: true };
      }
      return { ok: true, brokerPositionId: 'new-buy-position' };
    },
    stateBinder: async () => {},
  });

  assert.equal(summary.accounts[0].status, 'SUCCEEDED');
  assert.deepEqual(dispatched, [
    { groupId: 'old-sell-group', type: 'CLOSE_POSITION' },
    { groupId: 'new-buy-group', type: 'OPEN_POSITION' },
    { groupId: 'old-sell-group', type: 'CLOSE_POSITION' },
  ]);
  assert.equal(closeKeys[0], 'evt-reversal:old-close');
  assert.equal(closeKeys[1], 'evt-reversal:old-close:retry-after-entry');
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

  assert.equal(bound.length, 2);
  const failedBinding = bound.find((binding) => binding.accountId === 'acct-a');
  assert.ok(failedBinding);
  assert.equal(failedBinding.groupId, 'group-a');
  assert.equal(failedBinding.legId, 'leg-1');
  assert.equal(failedBinding.actionType, 'OPEN_POSITION');
  assert.equal(failedBinding.status, 'FAILED');
  assert.equal(failedBinding.failureCode, 'BROKER_DISPATCH_FAILED');

  const successBinding = bound.find((binding) => binding.accountId === 'acct-b');
  assert.ok(successBinding);
  assert.equal(successBinding.groupId, 'group-b');
  assert.equal(successBinding.legId, 'leg-b');
  assert.equal(successBinding.actionType, 'OPEN_POSITION');
  assert.equal(successBinding.status, 'OPEN');
  assert.equal(successBinding.brokerPositionId, 'position-b');
});

test('one follower broker-risk failure cannot suppress the parent or another follower', async () => {
  const dispatched = [];
  const riskContexts = [];
  const accountRows = {
    parent: account({ id: 'parent' }),
    followerA: account({ id: 'followerA', followerLink: { risk_mode: 'balance_percent', risk_percent: 1, risk_basis: 'balance' } }),
    followerB: account({ id: 'followerB', followerLink: { risk_mode: 'fixed_risk', risk_amount: 75, risk_basis: 'equity' } }),
  };
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-follower-isolation',
    brokerExecutionEnabled: true,
    accountPlans: [
      plan({ accountId: 'parent', groupId: 'parent-group' }),
      plan({ accountId: 'followerA', groupId: 'follower-a-group' }),
      plan({ accountId: 'followerB', groupId: 'follower-b-group' }),
    ],
  }, {
    accountLoader: async (_workspaceId, accountId) => accountRows[accountId],
    riskMaterializer: async ({ account, action }) => {
      riskContexts.push({
        accountId: account.id,
        mode: account.followerLink?.risk_mode ?? 'parent',
        amount: account.followerLink?.risk_amount ?? null,
        percent: account.followerLink?.risk_percent ?? null,
      });
      if (account.id === 'followerA') {
        const error = new Error('follower broker context unavailable');
        error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
        throw error;
      }
      return {
        allowed: true,
        action,
        policyContext: {
          totalLots: action.lots,
          riskPercent: 0.5,
          minimumVolumeRiskOveragePercent: 0,
          currentDailyPnlPercent: 0,
          currentOpenRiskPercent: 0,
        },
      };
    },
    dispatchAction: async ({ account: row }) => {
      dispatched.push(row.id);
      return { ok: true, brokerPositionId: `position-${row.id}` };
    },
    stateBinder: async () => {},
  });

  assert.deepEqual(dispatched.sort(), ['followerB', 'parent']);
  assert.equal(summary.succeeded, 2);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.status, 'PARTIAL');
  assert.deepEqual(summary.accounts.map((row) => [row.accountId, row.status]).sort((a, b) => a[0].localeCompare(b[0])), [
    ['followerA', 'BLOCKED'],
    ['followerB', 'SUCCEEDED'],
    ['parent', 'SUCCEEDED'],
  ]);
  assert.deepEqual(riskContexts.sort((a, b) => a.accountId.localeCompare(b.accountId)), [
    { accountId: 'followerA', mode: 'balance_percent', amount: null, percent: 1 },
    { accountId: 'followerB', mode: 'fixed_risk', amount: 75, percent: null },
    { accountId: 'parent', mode: 'parent', amount: null, percent: null },
  ]);
});

test('successful MODIFY_POSITION binds requested SL/TP even when broker returns no new identifiers', async () => {
  const bound = [];
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-modify', brokerExecutionEnabled: true,
    accountPlans: [plan({ actions: [{
      type: 'MODIFY_POSITION', symbol: 'XAUUSD', brokerPositionId: 'position-1', legId: 'leg-1',
      stopLoss: 2495, takeProfit: 2515, idempotencyKey: 'evt-modify:acct-a:leg:1:modify',
    }] })],
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => ({ ok: true }),
    stateBinder: async (binding) => { bound.push(binding); },
  });

  assert.equal(summary.accounts[0].status, 'SUCCEEDED');
  assert.equal(bound.length, 1);
  assert.equal(bound[0].actionType, 'MODIFY_POSITION');
  assert.equal(bound[0].brokerPositionId, null);
  assert.equal(bound[0].stopLoss, 2495);
  assert.equal(bound[0].takeProfit, 2515);
});

test('final durable authority is reloaded before every action so revocation after action one blocks action two', async () => {
  let authorityCalls = 0;
  let dispatchCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-db-1',
    brokerExecutionEnabled: true,
    accountPlans: [plan({
      actions: [
        openAction({ idempotencyKey: 'evt-db-1:acct-a:leg:1', legId: 'leg-1' }),
        openAction({ idempotencyKey: 'evt-db-1:acct-a:leg:2', legId: 'leg-2' }),
      ],
    })],
  }, {
    accountLoader: async () => account(),
    authorityLoader: async ({ workspaceId, tradingEventId, accountId }) => {
      authorityCalls += 1;
      assert.equal(workspaceId, 'ws-a');
      assert.equal(tradingEventId, 'evt-db-1');
      assert.equal(accountId, 'acct-a');
      return {
        event: { id: 'evt-db-1', workspace_id: 'ws-a', source_connection_id: 'src-1' },
        source: { id: 'src-1', workspace_id: 'ws-a', is_active: true },
        workspace: { id: 'ws-a', trading_access_enabled: true },
        account: authorityCalls === 1
          ? account()
          : account({ safety_policy: { enabled: true, killSwitch: true } }),
      };
    },
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true }; },
    stateBinder: async () => {},
  });

  assert.equal(authorityCalls, 2);
  assert.equal(dispatchCalls, 1);
  assert.equal(summary.accounts[0].status, 'BLOCKED');
});


test('minimum-volume fallback authorization is still blocked when its risk overage exceeds account tolerance', async () => {
  let dispatchCalls = 0;
  let authorizationCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-min-floor', brokerExecutionEnabled: true,
    accountPlans: [plan()],
  }, {
    accountLoader: async () => account({
      safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 2 },
    }),
    riskMaterializer: async ({ action }) => ({
      allowed: true,
      action: { ...action, minimumVolumeFallbackAuthorized: true },
      authorizeMinimumVolumeFallback: () => { authorizationCalls += 1; return true; },
      policyRequest: {
        totalLots: 0.1,
        riskPercent: 0.1,
        minimumVolumeRiskOveragePercent: 0.09,
        currentDailyPnlPercent: 0,
        currentOpenRiskPercent: 0,
      },
    }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true }; },
    stateBinder: async () => {},
  });

  assert.equal(dispatchCalls, 0);
  assert.equal(authorizationCalls, 0, 'fallback capability must not be minted before policy approval');
  assert.equal(summary.accounts[0].status, 'BLOCKED');
  assert.ok(summary.accounts[0].policy.reasons.includes('MINIMUM_VOLUME_RISK_TOLERANCE_EXCEEDED'));
});

test('minimum-volume fallback capability is minted only after the coordinator approves policy', async () => {
  let authorizationCalls = 0;
  let dispatchCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-min-floor-approved', brokerExecutionEnabled: true,
    accountPlans: [plan()],
  }, {
    accountLoader: async () => account({
      safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 1 },
    }),
    riskMaterializer: async ({ action }) => ({
      allowed: true,
      action: { ...action, minimumVolumeFallbackAuthorized: true },
      policyRequest: {
        totalLots: 0.1,
        riskPercent: 0.95,
        minimumVolumeRiskOveragePercent: 0.05,
        currentDailyPnlPercent: 0,
        currentOpenRiskPercent: 0,
      },
      authorizeMinimumVolumeFallback: (candidate, policy) => {
        authorizationCalls += 1;
        assert.equal(policy.allowed, true);
        assert.equal(candidate.minimumVolumeFallbackAuthorized, true);
        return true;
      },
    }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true, brokerPositionId: 'p-min-floor' }; },
    stateBinder: async () => {},
  });

  assert.equal(authorizationCalls, 1);
  assert.equal(dispatchCalls, 1);
  assert.equal(summary.accounts[0].status, 'SUCCEEDED');
});


test('maxLotsPerTrade accumulates accepted TP-leg volume within one account plan', async () => {
  let dispatchCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-lot-legs', brokerExecutionEnabled: true,
    accountPlans: [plan({ actions: [
      openAction({ lots: 0.01, legId: 'tp-1', idempotencyKey: 'evt-lot-legs:tp-1' }),
      openAction({ lots: 0.01, legId: 'tp-2', idempotencyKey: 'evt-lot-legs:tp-2' }),
    ] })],
  }, {
    accountLoader: async () => account({
      safety_policy: { enabled: true, killSwitch: false, maxLotsPerTrade: 0.015 },
    }),
    riskMaterializer: async ({ action }) => ({
      allowed: true,
      action,
      policyContext: {
        totalLots: action.lots,
        riskPercent: 0.5,
        currentDailyPnlPercent: 0,
        currentOpenRiskPercent: 0,
      },
    }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true, brokerPositionId: 'p-1' }; },
    stateBinder: async () => {},
  });

  assert.equal(dispatchCalls, 1);
  assert.equal(summary.accounts[0].status, 'PARTIAL');
  assert.equal(summary.accounts[0].actions[1].status, 'BLOCKED');
  assert.deepEqual(summary.accounts[0].actions[1].policy.reasons, ['MAX_LOTS_EXCEEDED']);
});

test('max open risk accumulates accepted TP-leg risk within one account plan', async () => {
  let dispatchCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-risk-legs', brokerExecutionEnabled: true,
    accountPlans: [plan({
      currentOpenRiskPercent: 1,
      actions: [
        openAction({ legId: 'tp-1', idempotencyKey: 'evt-risk-legs:tp-1' }),
        openAction({ legId: 'tp-2', idempotencyKey: 'evt-risk-legs:tp-2' }),
      ],
    })],
  }, {
    accountLoader: async () => account({
      safety_policy: { enabled: true, killSwitch: false, maxOpenRiskPercent: 2 },
    }),
    riskMaterializer: async ({ action }) => ({
      allowed: true,
      action,
      policyContext: {
        totalLots: action.lots,
        riskPercent: 0.75,
        currentDailyPnlPercent: 0,
        currentOpenRiskPercent: 1,
      },
    }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true, brokerPositionId: 'p-1' }; },
    stateBinder: async () => {},
  });

  assert.equal(dispatchCalls, 1);
  assert.equal(summary.accounts[0].status, 'PARTIAL');
  assert.equal(summary.accounts[0].actions[1].status, 'BLOCKED');
  assert.deepEqual(summary.accounts[0].actions[1].policy.reasons, ['OPEN_RISK_LIMIT']);
});


test('refreshed broker exposure that already includes prior TP risk is not double-counted', async () => {
  let dispatchCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-risk-refresh', brokerExecutionEnabled: true,
    accountPlans: [plan({
      currentOpenRiskPercent: 1,
      actions: [
        openAction({ legId: 'tp-1', idempotencyKey: 'evt-risk-refresh:tp-1' }),
        openAction({ legId: 'tp-2', idempotencyKey: 'evt-risk-refresh:tp-2' }),
      ],
    })],
  }, {
    accountLoader: async () => account({
      safety_policy: { enabled: true, killSwitch: false, maxOpenRiskPercent: 2.5 },
    }),
    riskMaterializer: async ({ action }) => ({
      allowed: true,
      action,
      policyContext: {
        totalLots: action.lots,
        riskPercent: 0.75,
        currentDailyPnlPercent: 0,
        currentOpenRiskPercent: dispatchCalls === 0 ? 1 : 1.75,
      },
    }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true, brokerPositionId: 'p-1' }; },
    stateBinder: async () => {},
  });

  assert.equal(dispatchCalls, 2);
  assert.equal(summary.accounts[0].status, 'SUCCEEDED');
});


test('accepted OPEN risk is reserved even when state binding fails before the next TP leg', async () => {
  const policyRequests = [];
  let dispatchCalls = 0;
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-risk-bind-failure', brokerExecutionEnabled: true,
    accountPlans: [plan({
      currentOpenRiskPercent: 1,
      actions: [
        openAction({ legId: 'tp-1', idempotencyKey: 'evt-risk-bind-failure:tp-1' }),
        openAction({ legId: 'tp-2', idempotencyKey: 'evt-risk-bind-failure:tp-2' }),
      ],
    })],
  }, {
    accountLoader: async () => account({
      safety_policy: { enabled: true, killSwitch: false, maxOpenRiskPercent: 2 },
    }),
    riskMaterializer: async ({ action }) => ({
      allowed: true,
      action,
      policyContext: {
        totalLots: action.lots,
        riskPercent: 0.75,
        currentDailyPnlPercent: 0,
        currentOpenRiskPercent: 1,
      },
    }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true, brokerPositionId: 'p-1' }; },
    stateBinder: async () => { throw new Error('simulated persistence failure'); },
    bindingRepairRecorder: async () => {},
  });

  assert.equal(dispatchCalls, 1, 'second TP must be blocked before broker dispatch');
  assert.equal(summary.accounts[0].status, 'FAILED');
  assert.equal(summary.accounts[0].actions[0].reason, 'STATE_BIND_FAILED');
  assert.equal(summary.accounts[0].actions[1].status, 'BLOCKED');
  assert.deepEqual(summary.accounts[0].actions[1].policy.reasons, ['OPEN_RISK_LIMIT']);
});


test('follower accounts load and materialize risk independently from their own account economics', async () => {
  const sized = [];
  const dispatched = [];
  const summary = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-independent-sizing', brokerExecutionEnabled: true,
    accountPlans: [
      plan({ accountId: 'acct-small', actions: [openAction({ idempotencyKey: 'evt-independent-sizing:small', lots: 0.01 })] }),
      plan({ accountId: 'acct-large', actions: [openAction({ idempotencyKey: 'evt-independent-sizing:large', lots: 0.01 })] }),
    ],
  }, {
    accountLoader: async (_workspaceId, accountId) => account({
      id: accountId,
      equity: accountId === 'acct-small' ? 1000 : 10000,
      balance: accountId === 'acct-small' ? 900 : 9500,
    }),
    riskMaterializer: async ({ account: currentAccount, action }) => {
      const lots = currentAccount.equity * 0.001 / 100;
      sized.push({ accountId: currentAccount.id, equity: currentAccount.equity, lots });
      return {
        allowed: true,
        action: { ...action, lots },
        policyContext: { totalLots: lots, riskPercent: 0.1, currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 },
      };
    },
    dispatchAction: async ({ account: currentAccount, action }) => {
      dispatched.push({ accountId: currentAccount.id, lots: action.lots });
      return { ok: true, brokerPositionId: `position-${currentAccount.id}` };
    },
    stateBinder: async () => {},
  });

  assert.equal(summary.succeeded, 2);
  assert.deepEqual(sized, [
    { accountId: 'acct-small', equity: 1000, lots: 0.01 },
    { accountId: 'acct-large', equity: 10000, lots: 0.1 },
  ]);
  assert.deepEqual(dispatched, [
    { accountId: 'acct-small', lots: 0.01 },
    { accountId: 'acct-large', lots: 0.1 },
  ]);
});
