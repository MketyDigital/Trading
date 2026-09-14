import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections_account_controls.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';
import { validateProductionRiskAction } from '../src/execution/production_risk_authority.js';
import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

const authorization = {
  ok: true,
  workspace: { id: 'ws-1' },
  auth: { subject: 'owner-1' },
  membership: { role: 'owner' },
};

function accountRow(overrides = {}) {
  return {
    id: 'acc-demo',
    workspace_id: 'ws-1',
    platform: 'ctrader',
    provider_mode: 'ctrader_oauth',
    account_id: '12345',
    environment: 'demo',
    roles: ['execution'],
    is_active: true,
    execution_enabled: true,
    live_execution_enabled: false,
    safety_policy: { killSwitch: false },
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    ...overrides,
  };
}

function accountControlSupabase(initial) {
  let current = structuredClone(initial);
  const updates = [];
  return {
    updates,
    from(table) {
      assert.equal(table, 'trade_accounts');
      let patch = null;
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        update(value) { patch = value; updates.push(value); return chain; },
        async maybeSingle() {
          if (patch) current = { ...current, ...patch };
          return { data: current, error: null };
        },
      };
      return chain;
    },
  };
}

test('connected DEMO execution account cannot be switched off from account controls', async () => {
  const supabase = accountControlSupabase(accountRow());
  const response = await handleV1AdminConnectionsRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/accounts/acc-demo', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tradingEnabled: false }),
    }),
    {},
    { supabaseFactory: async () => supabase, authorizeFn: async () => authorization },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, reason: 'DEMO_TRADING_ALWAYS_ENABLED' });
  assert.equal(supabase.updates.length, 0);
});

test('matched management actions preserve leg identity and get replay-stable idempotency keys', async () => {
  const group = {
    id: 'group-1', workspaceId: 'ws-1', tradeAccountId: 'acc-demo', sourceInstanceId: 'src-1',
    sourceEventIds: ['telegram:-1001:10'], symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET',
    entryPrice: 2500, status: 'OPEN', incomplete: false, createdAt: 1000, updatedAt: 1000,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.02, status: 'OPEN', brokerPositionId: 'p-1', volumeStepLots: 0.01 }],
  };
  const persisted = [];
  const event = {
    workspace_hint: 'ws-1', source: { instance_id: 'src-1' },
    external_event_id: 'telegram:-1001:11', thread: { reply_to_event_id: 'telegram:-1001:10' },
  };
  const deps = {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'group-1' }) },
    stateStore: {
      getGroup: async () => structuredClone(group),
      putGroup: async (value) => { persisted.push(structuredClone(value)); return value; },
    },
    accountProvider: async () => [accountRow()],
    instrumentProvider: async () => ({}),
  };

  const first = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    eventId: 'db-event-11', nowMs: 2000,
  }, deps);
  const second = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    eventId: 'db-event-11', nowMs: 2000,
  }, deps);

  const a = first.accounts[0].actions[0];
  const b = second.accounts[0].actions[0];
  assert.equal(a.legId, 'leg-1');
  assert.equal(a.targetIndex, 1);
  assert.ok(a.idempotencyKey);
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.match(a.idempotencyKey, /telegram:-1001:11/);
  assert.equal(persisted.length, 2);
});

test('non-volume management can pass production risk validation without lots', () => {
  const account = accountRow();
  const modify = validateProductionRiskAction({
    account,
    action: { type: 'MODIFY_POSITION', brokerPositionId: 'p-1', symbol: 'XAUUSD', stopLoss: 2500 },
    exposure: {},
  });
  assert.equal(modify.allowed, true);
  assert.equal(modify.action.lots, undefined);

  const cancel = validateProductionRiskAction({
    account,
    action: { type: 'CANCEL_PENDING', brokerOrderId: 'o-1', symbol: 'XAUUSD' },
    exposure: {},
  });
  assert.equal(cancel.allowed, true);
  assert.equal(cancel.action.lots, undefined);
});

test('production lifecycle binds full close as CLOSED rather than reopening the durable leg', async () => {
  const bindings = [];
  const result = await executeProductionPlan({
    workspaceId: 'ws-1', eventId: 'evt-close', brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: false, liveBrokerExecutionControlAvailable: true,
    accountPlans: [{
      accountId: 'acc-demo', groupId: 'group-1',
      actions: [{ type: 'CLOSE_POSITION', legId: 'leg-1', brokerPositionId: 'p-1', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'close-1' }],
    }],
  }, {
    accountLoader: async () => accountRow(),
    authorityLoader: async () => ({ account: accountRow(), source: { id: 'src-1' } }),
    riskMaterializer: async ({ action }) => ({ allowed: true, action }),
    dispatchAction: async () => ({ ok: true, brokerPositionId: 'p-1', brokerDealId: 'd-close', executedLots: 0.01 }),
    stateBinder: async (binding) => { bindings.push(binding); },
  });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].status, 'CLOSED');
});
