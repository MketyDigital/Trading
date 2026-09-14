import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections_account_controls.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';
import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';
import { validateProductionRiskAction } from '../src/execution/production_risk_authority.js';
import { productionTradeStateBindingPayload } from '../src/state/production_trade_state_binder.js';
import { TradeStateStore } from '../src/state/trade_state_store.js';

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

function managementFixture() {
  const group = {
    id: 'group-1', workspaceId: 'ws-1', tradeAccountId: 'acc-demo', sourceInstanceId: 'src-1',
    sourceEventIds: ['telegram:-1001:10'], symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET',
    entryPrice: 2500, status: 'OPEN', incomplete: false, createdAt: 1000, updatedAt: 1000,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.02, status: 'OPEN', brokerPositionId: 'p-1', volumeStepLots: 0.01 }],
  };
  const event = {
    workspace_hint: 'ws-1', source: { instance_id: 'src-1' },
    external_event_id: 'telegram:-1001:11', thread: { reply_to_event_id: 'telegram:-1001:10' },
  };
  const deps = {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'group-1' }) },
    stateStore: {
      getGroup: async () => structuredClone(group),
      putGroup: async (value) => value,
    },
    accountProvider: async () => [accountRow()],
    instrumentProvider: async () => ({}),
  };
  return { group, event, deps };
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

test('matched management planning preserves the exact broker-bound leg identity', async () => {
  const { event, deps } = managementFixture();
  const planned = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    eventId: 'db-event-11', nowMs: 2000,
  }, deps);

  const action = planned.accounts[0].actions[0];
  assert.equal(action.legId, 'leg-1');
  assert.equal(action.targetIndex, 1);
  assert.equal(action.brokerPositionId, 'p-1');
});

test('production stage assigns replay-stable idempotency to management actions before dispatch', async () => {
  const { event, deps } = managementFixture();
  const simulation = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    eventId: 'db-event-11', nowMs: 2000,
  }, deps);
  let firstPlans;
  let secondPlans;
  const common = {
    env: {}, supabase: {}, result: { ok: true, duplicate: false, eventId: 'db-event-11', event }, simulation,
    executionDepsFactory: async () => ({ stateBinder: async () => {} }),
    bindingRepairRecorderFactory: () => async () => {},
    tradingAccessControlResolver: async () => ({ ok: true, enabled: true }),
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
    liveBrokerExecutionControlResolver: async () => ({ ok: true, enabled: false }),
  };

  await runV1ProductionExecutionStage({
    ...common,
    executeProductionFn: async ({ accountPlans }) => { firstPlans = structuredClone(accountPlans); return { status: 'SUCCEEDED' }; },
  });
  await runV1ProductionExecutionStage({
    ...common,
    executeProductionFn: async ({ accountPlans }) => { secondPlans = structuredClone(accountPlans); return { status: 'SUCCEEDED' }; },
  });

  const first = firstPlans[0].actions[0];
  const second = secondPlans[0].actions[0];
  assert.ok(first.idempotencyKey);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.match(first.idempotencyKey, /telegram:-1001:11/);
  assert.equal(first.legId, 'leg-1');
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

test('production binding normalizes full close and pending cancel lifecycle status', () => {
  const close = productionTradeStateBindingPayload({
    actionType: 'CLOSE_POSITION', status: 'OPEN', brokerPositionId: 'p-1', executedLots: 0.01,
  });
  assert.equal(close.status, 'CLOSED');

  const cancel = productionTradeStateBindingPayload({
    actionType: 'CANCEL_PENDING', status: 'PENDING', brokerOrderId: 'o-1',
  });
  assert.equal(cancel.status, 'CANCELLED');
});

test('durable state subtracts partial-close volume and closes a fully closed leg', async () => {
  const values = new Map();
  const storage = {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async list() { return new Map(values); },
  };
  const store = new TradeStateStore(storage);
  await store.putGroup({
    id: 'g', status: 'OPEN', sourceEventIds: ['evt'],
    legs: [{ legId: 'leg-1', status: 'OPEN', lots: 0.02, brokerPositionId: 'p-1' }],
  });

  const partial = await store.bindLegExecution('g', 'leg-1', {
    actionType: 'CLOSE_PARTIAL', status: 'OPEN', executedLots: 0.01, brokerPositionId: 'p-1',
  }, 10);
  assert.equal(partial.status, 'OPEN');
  assert.equal(partial.legs[0].status, 'OPEN');
  assert.equal(partial.legs[0].lots, 0.01);

  const closed = await store.bindLegExecution('g', 'leg-1', {
    actionType: 'CLOSE_POSITION', status: 'OPEN', executedLots: 0.01, brokerPositionId: 'p-1',
  }, 20);
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.legs[0].status, 'CLOSED');
  assert.equal(closed.legs[0].lots, 0);
});
