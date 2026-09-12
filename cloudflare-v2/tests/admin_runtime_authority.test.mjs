import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';
import { handleMketyAdminAccessCodesRequest } from '../src/http/v1_mkety_admin_access_codes.js';
import { runV1DestinationDeliveryStage } from '../src/destinations/v1_destination_delivery_stage.js';
import { createProductionDestinationRetryRuntime } from '../src/execution/destination_retry_production.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const ingestResult = {
  ok: true,
  duplicate: false,
  eventId: 'event-1',
  event: { workspace_hint: workspaceId },
};
const readySimulation = {
  status: 'SIMULATED',
  accounts: [{ accountId: 'account-1', status: 'READY', actions: [{ type: 'OPEN_POSITION', symbol: 'XAUUSD' }] }],
};

const tradingOn = async () => ({ ok: true, enabled: true });
const liveOff = async () => ({ ok: true, enabled: false });

test('persisted admin broker switch can enable execution without a deployment env toggle', async () => {
  let executed = false;
  const result = await runV1ProductionExecutionStage({
    env: { TRADING_ACCESS_ENABLED: 'false', BROKER_EXECUTION_ENABLED: 'false' },
    supabase: { from() {} },
    result: ingestResult,
    simulation: readySimulation,
    tradingAccessControlResolver: tradingOn,
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
    liveBrokerExecutionControlResolver: liveOff,
    executionDepsFactory: async () => ({}),
    bindingRepairRecorderFactory: () => ({}),
    executeProductionFn: async (input) => {
      assert.equal(input.liveBrokerExecutionEnabled, false);
      executed = true;
      return { executionEnabled: true, status: 'SUCCEEDED', accounts: [], succeeded: 1, failed: 0, blocked: 0 };
    },
  });
  assert.equal(executed, true);
  assert.equal(result.executionEnabled, true);
  assert.equal(result.status, 'SUCCEEDED');
});

test('staff runtime-control API reports the persisted DB switch as effective regardless of deployment env value', async () => {
  let enabled = true;
  const runtimeStore = {
    async getBrokerExecutionEnabled() { return { ok: true, enabled }; },
    async setBrokerExecutionEnabled(next) { enabled = Boolean(next); return { ok: true, enabled }; },
    async getTradingAccessEnabled() { return { ok: true, enabled: true }; },
    async getLiveBrokerExecutionEnabled() { return { ok: true, enabled: false }; },
  };
  const response = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/runtime-controls', {
    headers: { 'X-Mkety-Admin-Secret': 'admin-secret' },
  }), {
    MKETY_TRADING_ADMIN_SECRET: 'admin-secret',
    BROKER_EXECUTION_ENABLED: 'false',
  }, { store: {}, runtimeStore });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.brokerExecutionEnabled, true);
  assert.equal(body.effectiveBrokerExecutionEnabled, true);
});

test('broker destination routing does not depend on deployment env broker toggle', async () => {
  const destinationStore = {
    async listRoutedDestinations() {
      return [{
        id: 'dest-1', workspace_id: workspaceId, destination_type: 'broker_account',
        destination_ref: 'trade-account:account-1', is_active: true,
      }];
    },
    async recordDestinationOutcome() {},
  };
  const result = await runV1DestinationDeliveryStage({
    workspaceId,
    sourceId: 'source-1',
    event: { text: 'BUY XAUUSD' },
    interpretation: { status: 'READY' },
    env: { BROKER_EXECUTION_ENABLED: 'false' },
  }, { destinationStore });
  assert.equal(result.status, 'ROUTED');
  assert.equal(result.routed, 1);
  assert.equal(result.outcomes[0].status, 'ROUTED');
});

test('production retry runtime follows persisted admin broker switch instead of deployment env toggle', async () => {
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => [],
    deliveryStoreFactory: () => ({}),
    executionDepsFactory: async () => ({}),
    executeProductionFn: async () => ({ accounts: [] }),
    tradingAccessControlResolver: tradingOn,
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
    liveBrokerExecutionControlResolver: liveOff,
  });
  const result = await runtime({ TRADING_ACCESS_ENABLED: 'false', BROKER_EXECUTION_ENABLED: 'false' }, { nowMs: 1800000000000 });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.scanned, 0);
});

test('turning the persisted admin broker switch OFF stops retry scanning before any delivery can dispatch', async () => {
  let listed = false;
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => { listed = true; return []; },
    deliveryStoreFactory: () => ({}),
    executionDepsFactory: async () => ({}),
    executeProductionFn: async () => ({ accounts: [] }),
    tradingAccessControlResolver: tradingOn,
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: false }),
    liveBrokerExecutionControlResolver: liveOff,
  });
  const result = await runtime({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' }, { nowMs: 1800000000000 });
  assert.equal(listed, false);
  assert.equal(result.status, 'BROKER_OWNER_SWITCH_OFF');
  assert.equal(result.scanned, 0);
  assert.equal(result.dispatched, 0);
});

test('retry processing fails closed when the persisted admin runtime control cannot be read', async () => {
  let listed = false;
  const runtime = createProductionDestinationRetryRuntime({
    supabaseFactory: async () => ({ from() {} }),
    listDueFn: async () => { listed = true; return []; },
    deliveryStoreFactory: () => ({}),
    executionDepsFactory: async () => ({}),
    executeProductionFn: async () => ({ accounts: [] }),
    tradingAccessControlResolver: tradingOn,
    brokerExecutionControlResolver: async () => ({ ok: false, enabled: false, reason: 'RUNTIME_CONTROL_UNAVAILABLE' }),
    liveBrokerExecutionControlResolver: liveOff,
  });
  const result = await runtime({ TRADING_ACCESS_ENABLED: 'true' }, { nowMs: 1800000000000 });
  assert.equal(listed, false);
  assert.equal(result.status, 'BROKER_RUNTIME_CONTROL_UNAVAILABLE');
  assert.equal(result.scanned, 0);
  assert.equal(result.dispatched, 0);
});
