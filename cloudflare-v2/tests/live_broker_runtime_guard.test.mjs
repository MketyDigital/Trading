import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

function account(id, environment, overrides = {}) {
  return {
    id,
    workspace_id: 'ws-1',
    platform: 'mt5',
    environment,
    is_active: true,
    execution_enabled: true,
    live_execution_enabled: environment === 'live',
    safety_policy: { enabled: true, killSwitch: false },
    ...overrides,
  };
}

function plan(id, overrides = {}) {
  return {
    accountId: id,
    groupId: `group-${id}`,
    // A forged environment on the plan must never carry authority.
    environment: 'demo',
    actions: [{ type: 'OPEN_POSITION', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: `evt:${id}:1` }],
    ...overrides,
  };
}

async function execute({ rows, liveEnabled, liveAvailable = true }) {
  let dispatches = [];
  const result = await executeProductionPlan({
    workspaceId: 'ws-1',
    eventId: 'evt-1',
    accountPlans: Object.keys(rows).map((id) => plan(id)),
    brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: liveEnabled,
    liveBrokerExecutionControlAvailable: liveAvailable,
  }, {
    accountLoader: async (_workspaceId, accountId) => rows[accountId] || null,
    dispatchAction: async ({ account }) => {
      dispatches.push(account.id);
      return { ok: true, brokerOrderId: `order-${account.id}` };
    },
  });
  return { result, dispatches };
}

test('demo account executes while global live-money switch is OFF', async () => {
  const { result, dispatches } = await execute({ rows: { demo: account('demo', 'demo') }, liveEnabled: false });
  assert.deepEqual(dispatches, ['demo']);
  assert.equal(result.accounts[0].status, 'SUCCEEDED');
});

test('live account is blocked when global live-money switch is OFF even if plan claims demo', async () => {
  const { result, dispatches } = await execute({ rows: { live: account('live', 'live') }, liveEnabled: false });
  assert.deepEqual(dispatches, []);
  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.equal(result.accounts[0].reason, 'LIVE_BROKER_EXECUTION_DISABLED');
});

test('live account fails closed when live runtime-control state is unavailable', async () => {
  const { result, dispatches } = await execute({ rows: { live: account('live', 'live') }, liveEnabled: false, liveAvailable: false });
  assert.deepEqual(dispatches, []);
  assert.equal(result.accounts[0].reason, 'LIVE_BROKER_RUNTIME_CONTROL_UNAVAILABLE');
});

test('live account requires both global live switch and per-account live execution opt-in', async () => {
  const disabledAccount = account('live', 'live', { live_execution_enabled: false });
  const blocked = await execute({ rows: { live: disabledAccount }, liveEnabled: true });
  assert.deepEqual(blocked.dispatches, []);
  assert.equal(blocked.result.accounts[0].reason, 'ACCOUNT_LIVE_EXECUTION_DISABLED');

  const enabled = await execute({ rows: { live: account('live', 'live', { live_execution_enabled: true }) }, liveEnabled: true });
  assert.deepEqual(enabled.dispatches, ['live']);
  assert.equal(enabled.result.accounts[0].status, 'SUCCEEDED');
});

test('mixed demo/live batch executes demo and blocks live without stopping the batch', async () => {
  const { result, dispatches } = await execute({
    rows: { demo: account('demo', 'demo'), live: account('live', 'live') },
    liveEnabled: false,
  });
  assert.deepEqual(dispatches, ['demo']);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.succeeded, 1);
  assert.equal(result.blocked, 1);
  assert.equal(result.accounts.find((item) => item.accountId === 'live').reason, 'LIVE_BROKER_EXECUTION_DISABLED');
});

test('unknown account environment fails closed before broker dispatch', async () => {
  const { result, dispatches } = await execute({ rows: { unknown: account('unknown', 'production-ish') }, liveEnabled: true });
  assert.deepEqual(dispatches, []);
  assert.equal(result.accounts[0].reason, 'ACCOUNT_ENVIRONMENT_INVALID');
});
