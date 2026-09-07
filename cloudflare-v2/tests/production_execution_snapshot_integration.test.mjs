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

function action(legId) {
  return {
    type: 'OPEN_POSITION',
    symbol: 'XAUUSD',
    lots: 0.01,
    riskPercent: 0.5,
    idempotencyKey: `evt-1:acct-a:${legId}`,
    legId,
  };
}

function authority(row = account()) {
  return {
    event: { id: 'evt-1', workspace_id: 'ws-a', source_connection_id: 'src-1' },
    source: { id: 'src-1', workspace_id: 'ws-a', is_active: true },
    workspace: { id: 'ws-a', trading_access_enabled: true },
    account: row,
  };
}

test('repeated production actions may reuse one nonauthoritative snapshot while fresh authority and risk still run per action', async () => {
  let authorityCalls = 0;
  let snapshotCalls = 0;
  let riskCalls = 0;
  let dispatchCalls = 0;
  const sharedSnapshot = Object.freeze({
    workspaceId: 'ws-a',
    sourceId: 'src-1',
    accountId: 'acct-a',
    version: 'v1',
    platform: 'mt5',
    symbolCatalogVersion: 'symbols-v1',
  });

  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-1',
    brokerExecutionEnabled: true,
    accountPlans: [{ accountId: 'acct-a', groupId: 'group-a', actions: [action('leg-1'), action('leg-2')] }],
  }, {
    accountLoader: async () => account(),
    authorityLoader: async () => { authorityCalls += 1; return authority(); },
    snapshotLoader: async ({ workspaceId, sourceId, account: row }) => {
      snapshotCalls += 1;
      assert.equal(workspaceId, 'ws-a');
      assert.equal(sourceId, 'src-1');
      assert.equal(row.id, 'acct-a');
      return sharedSnapshot;
    },
    riskMaterializer: async ({ account: row, snapshot }) => {
      riskCalls += 1;
      assert.equal(row.is_active, true);
      assert.equal(row.execution_enabled, true);
      assert.equal(snapshot, sharedSnapshot);
      return {
        allowed: true,
        policyRequest: {
          totalLots: 0.01,
          riskPercent: 0.5,
          currentDailyPnlPercent: 0,
          currentOpenRiskPercent: 0,
        },
      };
    },
    dispatchAction: async ({ snapshot }) => {
      dispatchCalls += 1;
      assert.equal(snapshot, sharedSnapshot);
      return { ok: true };
    },
  });

  assert.equal(summary.accounts[0].status, 'SUCCEEDED');
  assert.equal(authorityCalls, 2);
  assert.equal(snapshotCalls, 2);
  assert.equal(riskCalls, 2);
  assert.equal(dispatchCalls, 2);
});

test('stale enabled snapshot cannot override fresh source workspace or account revocation', async () => {
  let authorityCalls = 0;
  let snapshotCalls = 0;
  let dispatchCalls = 0;

  const summary = await executeProductionPlan({
    workspaceId: 'ws-a',
    eventId: 'evt-1',
    brokerExecutionEnabled: true,
    accountPlans: [{ accountId: 'acct-a', groupId: 'group-a', actions: [action('leg-1'), action('leg-2')] }],
  }, {
    accountLoader: async () => account(),
    authorityLoader: async () => {
      authorityCalls += 1;
      if (authorityCalls === 1) return authority();
      const error = new Error('source revoked');
      error.code = 'EXECUTION_AUTHORITY_REVOKED';
      throw error;
    },
    snapshotLoader: async () => {
      snapshotCalls += 1;
      return {
        workspaceId: 'ws-a', sourceId: 'src-1', accountId: 'acct-a', version: 'v1',
        sourceEnabled: true, accountActive: true, executionEnabled: true,
        safetyPolicy: { enabled: true, killSwitch: false },
      };
    },
    riskMaterializer: async () => ({
      allowed: true,
      policyRequest: { totalLots: 0.01, riskPercent: 0.5, currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 },
    }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true }; },
  });

  assert.equal(authorityCalls, 2);
  assert.equal(snapshotCalls, 1);
  assert.equal(dispatchCalls, 1);
  assert.equal(summary.accounts[0].status, 'BLOCKED');
  assert.equal(summary.accounts[0].reason, 'EXECUTION_AUTHORITY_REVOKED');
});
