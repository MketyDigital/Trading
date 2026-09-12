import test from 'node:test';
import assert from 'node:assert/strict';

import { createTradingRuntimeControlStore } from '../src/persistence/supabase_runtime_control_store.js';
import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

function runtimeSupabase(seed = {}) {
  const rows = new Map(Object.entries(seed).map(([control_key, enabled]) => [control_key, { control_key, enabled, updated_at: null, updated_by: null }]));
  return {
    rows,
    from(table) {
      assert.equal(table, 'trading_runtime_controls');
      const state = { row: null, key: null };
      const chain = {
        select() { return chain; },
        eq(_column, value) { state.key = value; return chain; },
        async maybeSingle() { return { data: rows.get(state.key) || null, error: null }; },
        upsert(row) { state.row = row; rows.set(row.control_key, row); return chain; },
      };
      return chain;
    },
  };
}

function account(environment, liveExecutionEnabled = false) {
  return {
    id: 'acct-1', workspace_id: 'ws-1', platform: 'ctrader', environment,
    is_active: true, execution_enabled: true, live_execution_enabled: liveExecutionEnabled,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

function plan() {
  return [{ accountId: 'acct-1', groupId: 'g1', actions: [{ type: 'OPEN_POSITION', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'k1' }] }];
}

async function execute(row, liveBrokerExecutionEnabled) {
  let dispatches = 0;
  const result = await executeProductionPlan({
    workspaceId: 'ws-1', eventId: 'evt-1', accountPlans: plan(), brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled,
  }, {
    accountLoader: async () => row,
    dispatchAction: async () => { dispatches += 1; return { ok: true }; },
  });
  return { result, dispatches };
}

test('runtime control store persists trading access and live broker master independently', async () => {
  const supabase = runtimeSupabase({ broker_execution_enabled: true, trading_access_enabled: true, live_broker_execution_enabled: false });
  const store = createTradingRuntimeControlStore(supabase);
  assert.equal((await store.getTradingAccessEnabled()).enabled, true);
  assert.equal((await store.getLiveBrokerExecutionEnabled()).enabled, false);
  await store.setLiveBrokerExecutionEnabled(true, { updatedBy: 'test-admin' });
  assert.equal((await store.getLiveBrokerExecutionEnabled()).enabled, true);
  await store.setTradingAccessEnabled(false, { updatedBy: 'test-admin' });
  assert.equal((await store.getTradingAccessEnabled()).enabled, false);
});

test('demo account can execute while live master is OFF', async () => {
  const { result, dispatches } = await execute(account('demo', false), false);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(dispatches, 1);
});

test('live account is blocked unless both global and account live permissions are ON', async () => {
  for (const [globalLive, accountLive, expected] of [[false, false, 'LIVE_EXECUTION_GLOBAL_DISABLED'], [true, false, 'LIVE_EXECUTION_ACCOUNT_DISABLED'], [false, true, 'LIVE_EXECUTION_GLOBAL_DISABLED']]) {
    const { result, dispatches } = await execute(account('live', accountLive), globalLive);
    assert.equal(result.accounts[0].status, 'BLOCKED');
    assert.equal(result.accounts[0].reason, expected);
    assert.equal(dispatches, 0);
  }
  const allowed = await execute(account('live', true), true);
  assert.equal(allowed.result.status, 'SUCCEEDED');
  assert.equal(allowed.dispatches, 1);
});
