import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1EventsRequest } from '../src/http/v1_events.js';

function request() {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: JSON.stringify({
      external_event_id: 'caller-event-id-ignored',
      workspace_id: 'caller-workspace-ignored',
      execution_enabled: true,
      credentials: { token: 'caller-secret-must-not-flow' },
    }),
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });
}

test('V1 production-shaped path executes exactly once through real coordinator with enabled gates and fake broker dependencies', async () => {
  const seen = {
    accountLoads: 0,
    authorityLoads: 0,
    riskMaterializations: 0,
    dispatches: 0,
    bindings: 0,
  };
  const persistedAccount = {
    id: 'acct-1',
    workspace_id: 'ws-trusted',
    platform: 'mt5',
    account_id: '90001',
    is_active: true,
    execution_enabled: true,
    credential_ciphertext: 'synthetic-envelope',
    safety_policy: { enabled: true, killSwitch: false, maxLotsPerTrade: 0.1 },
  };
  const trustedEvent = {
    workspace_hint: 'ws-trusted',
    external_event_id: 'source-native-1',
    source: { instance_id: 'src-1' },
    thread: {},
  };
  const trustedInterpretation = {
    status: 'READY',
    intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
  };

  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'synthetic-master',
    TRADING_V1_SIMULATION: 'false',
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({
      ok: true,
      duplicate: false,
      eventId: 'db-event-1',
      event: trustedEvent,
      interpretation: trustedInterpretation,
    }),
    simulationDepsFactory: async () => ({ canonicalPlanning: true }),
    orchestrateFn: async ({ event, interpretation, eventId }, deps) => {
      assert.equal(event, trustedEvent);
      assert.equal(interpretation, trustedInterpretation);
      assert.equal(eventId, 'db-event-1');
      assert.equal(deps.canonicalPlanning, true);
      return {
        status: 'SIMULATED',
        executionEnabled: false,
        actions: [],
        accounts: [{
          accountId: 'acct-1',
          status: 'READY',
          groupId: 'group-1',
          actions: [{
            type: 'OPEN_POSITION',
            legId: 'leg-1',
            symbol: 'XAUUSD',
            lots: 0.01,
            idempotencyKey: 'group-1:leg:1',
            simulated: true,
          }],
        }],
      };
    },
    brokerExecutionControlResolver: async () => ({
      ok: true,
      enabled: true,
      reason: 'TEST_ENABLED',
    }),
    executionDepsFactory: async ({ workspaceId, tradingEventId }) => {
      assert.equal(workspaceId, 'ws-trusted');
      assert.equal(tradingEventId, 'db-event-1');
      return {
        async accountLoader(loadedWorkspaceId, accountId) {
          seen.accountLoads += 1;
          assert.equal(loadedWorkspaceId, 'ws-trusted');
          assert.equal(accountId, 'acct-1');
          return persistedAccount;
        },
        async authorityLoader(input) {
          seen.authorityLoads += 1;
          assert.equal(input.workspaceId, 'ws-trusted');
          assert.equal(input.tradingEventId, 'db-event-1');
          assert.equal(input.accountId, 'acct-1');
          return {
            workspace: { id: 'ws-trusted', trading_access_enabled: true },
            source: { id: 'src-1', workspace_id: 'ws-trusted', is_active: true },
            account: persistedAccount,
          };
        },
        async riskMaterializer({ workspaceId, eventId, account, action }) {
          seen.riskMaterializations += 1;
          assert.equal(workspaceId, 'ws-trusted');
          assert.equal(eventId, 'db-event-1');
          assert.equal(account, persistedAccount);
          assert.equal(action.simulated, undefined);
          return {
            allowed: true,
            action,
            policyRequest: {
              totalLots: 0.01,
              riskPercent: 0.1,
              currentDailyPnlPercent: 0,
              currentOpenRiskPercent: 0,
            },
          };
        },
        async dispatchAction({ workspaceId, eventId, groupId, account, action }) {
          seen.dispatches += 1;
          assert.equal(workspaceId, 'ws-trusted');
          assert.equal(eventId, 'db-event-1');
          assert.equal(groupId, 'group-1');
          assert.equal(account, persistedAccount);
          assert.equal(action.idempotencyKey, 'group-1:leg:1');
          return {
            brokerPositionId: 'fake-position-1',
            brokerOrderId: 'fake-order-1',
            brokerDealId: 'fake-deal-1',
            fillPrice: 2500.5,
          };
        },
        async stateBinder(binding) {
          seen.bindings += 1;
          seen.binding = binding;
        },
      };
    },
  });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.execution.executionEnabled, true);
  assert.equal(body.execution.status, 'SUCCEEDED');
  assert.equal(body.execution.succeeded, 1);
  assert.equal(body.execution.failed, 0);
  assert.equal(body.execution.blocked, 0);
  assert.deepEqual(seen, {
    accountLoads: 1,
    authorityLoads: 1,
    riskMaterializations: 1,
    dispatches: 1,
    bindings: 1,
    binding: {
      workspaceId: 'ws-trusted',
      eventId: 'db-event-1',
      accountId: 'acct-1',
      groupId: 'group-1',
      legId: 'leg-1',
      brokerPositionId: 'fake-position-1',
      brokerOrderId: 'fake-order-1',
      brokerDealId: 'fake-deal-1',
      fillPrice: 2500.5,
    },
  });
  assert.equal(JSON.stringify(body).includes('caller-secret-must-not-flow'), false);
  assert.equal(JSON.stringify(body).includes('caller-workspace-ignored'), false);
});
