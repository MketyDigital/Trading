import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1EventsRequest } from '../src/http/v1_events.js';

function request(body = '{}') {
  return new Request('https://trade.test/api/v1/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'sig' } });
}

function baseResult(overrides = {}) {
  return { ok: true, duplicate: false, eventId: 'db-event-1', event: { workspace_hint: 'ws-trusted', external_event_id: 'telegram:acct:chat:1', source: { instance_id: 'src-1' }, thread: {} }, interpretation: { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } }, ...overrides };
}

function baseDeps(overrides = {}) {
  return {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    simulationDepsFactory: async () => ({ safe: true }),
    orchestrateFn: async () => ({ status: 'SIMULATED', executionEnabled: false, actions: [], accounts: [{ accountId: 'acct-1', status: 'READY', groupId: 'group-1', actions: [{ type: 'OPEN_POSITION', legId: 'leg-1', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'group-1:leg:1', simulated: true }] }] }),
    ingestFn: async () => baseResult(),
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
    ...overrides,
  };
}

test('persisted broker-owner switch OFF returns blocked execution summary without constructing production dependencies', async () => {
  let executionDepsCalls = 0;
  let executeCalls = 0;
  const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' }, baseDeps({
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: false, reason: 'TEST_OWNER_DISABLED' }),
    executionDepsFactory: async () => { executionDepsCalls += 1; throw new Error('must not construct broker dependencies'); },
    executeProductionFn: async () => { executeCalls += 1; throw new Error('must not execute'); },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.simulation.status, 'SIMULATED');
  assert.equal(body.execution.status, 'BROKER_OWNER_SWITCH_OFF');
  assert.equal(body.execution.executionEnabled, false);
  assert.equal(executionDepsCalls, 0);
  assert.equal(executeCalls, 0);
});

test('trading-access-disabled V1 planning cannot construct production dependencies even when persisted broker switch is enabled', async () => {
  let executionDepsCalls = 0;
  let executeCalls = 0;
  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
    TRADING_V1_SIMULATION: 'true',
    TRADING_ACCESS_ENABLED: 'false',
    BROKER_EXECUTION_ENABLED: 'true',
  }, baseDeps({
    executionDepsFactory: async () => { executionDepsCalls += 1; return {}; },
    executeProductionFn: async () => { executeCalls += 1; return {}; },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.execution.status, 'TRADING_ACCESS_DISABLED');
  assert.equal(body.execution.executionEnabled, false);
  assert.equal(executionDepsCalls, 0);
  assert.equal(executeCalls, 0);
});

test('duplicates and NEEDS_REVIEW simulation never construct production execution dependencies', async () => {
  let executionDepsCalls = 0;
  let executeCalls = 0;
  for (const mode of ['duplicate', 'review']) {
    const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' }, baseDeps({
      ingestFn: async () => mode === 'duplicate' ? baseResult({ duplicate: true }) : baseResult(),
      orchestrateFn: async () => ({ status: 'NEEDS_REVIEW', executionEnabled: false, actions: [], accounts: [] }),
      executionDepsFactory: async () => { executionDepsCalls += 1; return {}; },
      executeProductionFn: async () => { executeCalls += 1; return {}; },
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    if (mode === 'duplicate') assert.equal(body.execution, undefined);
    else { assert.equal(body.simulation.status, 'NEEDS_REVIEW'); assert.equal(body.execution.status, 'NOT_EXECUTABLE'); }
  }
  assert.equal(executionDepsCalls, 0);
  assert.equal(executeCalls, 0);
});

test('broker-enabled stage forwards only trusted READY account actions, exact persisted event identity, and strips simulation-only fields', async () => {
  let dependencyInput;
  let executionInput;
  const trustedSimulation = { status: 'SIMULATED', executionEnabled: false, actions: [], accounts: [
    { accountId: 'acct-ready', status: 'READY', groupId: 'group-ready', actions: [{ type: 'OPEN_POSITION', legId: 'leg-1', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'group-ready:leg:1', simulated: true }] },
    { accountId: 'acct-blocked', status: 'BLOCKED', actions: [{ type: 'OPEN_POSITION', idempotencyKey: 'must-not-forward', simulated: true }] },
    { accountId: 'acct-waiting', status: 'WAITING', actions: [] },
  ] };
  const response = await handleV1EventsRequest(request(JSON.stringify({ workspace_id: 'ws-attacker', tradingEventId: 'evt-attacker', brokerExecutionEnabled: true, BROKER_EXECUTION_ENABLED: true, credentials: { token: 'caller-token' } })), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'false' }, baseDeps({
    orchestrateFn: async () => trustedSimulation,
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
    executionDepsFactory: async (input) => { dependencyInput = input; return { accountLoader() {}, authorityLoader() {}, dispatchAction() {}, stateBinder() {} }; },
    executeProductionFn: async (input) => { executionInput = input; return { executionEnabled: true, status: 'SUCCEEDED', accounts: [], succeeded: 1, failed: 0, blocked: 0 }; },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.execution.status, 'SUCCEEDED');
  assert.equal(dependencyInput.workspaceId, 'ws-trusted');
  assert.equal(dependencyInput.tradingEventId, 'db-event-1');
  assert.equal(executionInput.workspaceId, 'ws-trusted');
  assert.equal(executionInput.eventId, 'db-event-1');
  assert.equal(executionInput.brokerExecutionEnabled, true);
  assert.equal(executionInput.accountPlans.length, 1);
  assert.equal(executionInput.accountPlans[0].accountId, 'acct-ready');
  assert.equal(executionInput.accountPlans[0].groupId, 'group-ready');
  assert.equal(executionInput.accountPlans[0].actions[0].simulated, undefined);
  assert.equal(executionInput.accountPlans[0].actions[0].idempotencyKey, 'group-ready:leg:1');
  assert.equal(JSON.stringify(executionInput).includes('caller-token'), false);
  assert.equal(JSON.stringify(dependencyInput).includes('caller-token'), false);
  assert.equal(JSON.stringify(dependencyInput).includes('evt-attacker'), false);
});

test('caller payload and deployment env cannot enable broker execution when persisted owner switch is OFF', async () => {
  for (const serverValue of [undefined, 'false', 'true']) {
    let executionDepsCalls = 0;
    const response = await handleV1EventsRequest(request(JSON.stringify({ BROKER_EXECUTION_ENABLED: true, brokerExecutionEnabled: true, execution: { enabled: true } })), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', TRADING_ACCESS_ENABLED: 'true', ...(serverValue === undefined ? {} : { BROKER_EXECUTION_ENABLED: serverValue }) }, baseDeps({
      brokerExecutionControlResolver: async () => ({ ok: true, enabled: false, reason: 'TEST_OWNER_DISABLED' }),
      executionDepsFactory: async () => { executionDepsCalls += 1; return {}; },
    }));
    const body = await response.json();
    assert.equal(body.execution.status, 'BROKER_OWNER_SWITCH_OFF');
    assert.equal(body.execution.executionEnabled, false);
    assert.equal(executionDepsCalls, 0);
  }
});

test('real production stage uses broker-authoritative canonical policy inputs before dispatch', async () => {
  const cases = [
    {
      name: 'max lots',
      safety: { enabled: true, killSwitch: false, maxLotsPerTrade: 0.005 },
      policyRequest: { totalLots: 0.01, riskPercent: 0.25, currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 },
      expectedReason: 'MAX_LOTS_EXCEEDED',
    },
    {
      name: 'max risk percent',
      safety: { enabled: true, killSwitch: false, maxRiskPercent: 0.5 },
      policyRequest: { totalLots: 0.01, riskPercent: 1, currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 },
      expectedReason: 'MAX_RISK_EXCEEDED',
    },
    {
      name: 'daily loss',
      safety: { enabled: true, killSwitch: false, maxDailyLossPercent: 3 },
      policyRequest: { totalLots: 0.01, riskPercent: 0.25, currentDailyPnlPercent: -4, currentOpenRiskPercent: 0 },
      expectedReason: 'DAILY_LOSS_LIMIT',
    },
    {
      name: 'open risk',
      safety: { enabled: true, killSwitch: false, maxOpenRiskPercent: 1.5 },
      policyRequest: { totalLots: 0.01, riskPercent: 0.75, currentDailyPnlPercent: 0, currentOpenRiskPercent: 1 },
      expectedReason: 'OPEN_RISK_LIMIT',
    },
  ];

  for (const item of cases) {
    let dispatchCalls = 0;
    let materializerCalls = 0;
    const account = {
      id: 'acct-1', workspace_id: 'ws-trusted', platform: 'mt5', is_active: true, execution_enabled: true,
      safety_policy: item.safety,
    };
    const response = await handleV1EventsRequest(request(), {
      TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true',
      TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'false',
    }, baseDeps({
      brokerExecutionControlResolver: async () => ({ ok: true, enabled: true }),
      executionDepsFactory: async () => ({
        accountLoader: async () => account,
        authorityLoader: async () => ({ account }),
        riskMaterializer: async ({ action }) => {
          materializerCalls += 1;
          return { allowed: true, action, policyRequest: item.policyRequest };
        },
        dispatchAction: async () => { dispatchCalls += 1; return { ok: true }; },
        stateBinder: async () => {},
      }),
    }));
    const body = await response.json();
    assert.equal(materializerCalls, 1, item.name);
    assert.equal(dispatchCalls, 0, item.name);
    assert.equal(body.execution.status, 'BLOCKED', item.name);
    assert.ok(body.execution.accounts[0].policy.reasons.includes(item.expectedReason), item.name);
  }
});
