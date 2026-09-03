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
    ...overrides,
  };
}

test('broker-disabled V1 planning returns disabled execution summary without constructing production dependencies', async () => {
  let executionDepsCalls = 0;
  let executeCalls = 0;
  const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', BROKER_EXECUTION_ENABLED: 'false' }, baseDeps({
    executionDepsFactory: async () => { executionDepsCalls += 1; throw new Error('must not construct broker dependencies'); },
    executeProductionFn: async () => { executeCalls += 1; throw new Error('must not execute'); },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.simulation.status, 'SIMULATED');
  assert.equal(body.execution.status, 'BROKER_EXECUTION_DISABLED');
  assert.equal(body.execution.executionEnabled, false);
  assert.equal(executionDepsCalls, 0);
  assert.equal(executeCalls, 0);
});

test('duplicates and NEEDS_REVIEW simulation never construct production execution dependencies', async () => {
  let executionDepsCalls = 0;
  let executeCalls = 0;
  for (const mode of ['duplicate', 'review']) {
    const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', BROKER_EXECUTION_ENABLED: 'true' }, baseDeps({
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

test('broker-enabled stage forwards only trusted READY account actions and strips simulation-only fields', async () => {
  let dependencyInput;
  let executionInput;
  const trustedSimulation = { status: 'SIMULATED', executionEnabled: false, actions: [], accounts: [
    { accountId: 'acct-ready', status: 'READY', groupId: 'group-ready', actions: [{ type: 'OPEN_POSITION', legId: 'leg-1', symbol: 'XAUUSD', lots: 0.01, idempotencyKey: 'group-ready:leg:1', simulated: true }] },
    { accountId: 'acct-blocked', status: 'BLOCKED', actions: [{ type: 'OPEN_POSITION', idempotencyKey: 'must-not-forward', simulated: true }] },
    { accountId: 'acct-waiting', status: 'WAITING', actions: [] },
  ] };
  const response = await handleV1EventsRequest(request(JSON.stringify({ workspace_id: 'ws-attacker', brokerExecutionEnabled: true, BROKER_EXECUTION_ENABLED: true, credentials: { token: 'caller-token' } })), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', BROKER_EXECUTION_ENABLED: 'true' }, baseDeps({
    orchestrateFn: async () => trustedSimulation,
    executionDepsFactory: async (input) => { dependencyInput = input; return { accountLoader() {}, dispatchAction() {}, stateBinder() {} }; },
    executeProductionFn: async (input) => { executionInput = input; return { executionEnabled: true, status: 'SUCCEEDED', accounts: [], succeeded: 1, failed: 0, blocked: 0 }; },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.execution.status, 'SUCCEEDED');
  assert.equal(dependencyInput.workspaceId, 'ws-trusted');
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
});

test('caller payload cannot enable broker execution when server master fuse is absent or false', async () => {
  for (const serverValue of [undefined, 'false']) {
    let executionDepsCalls = 0;
    const response = await handleV1EventsRequest(request(JSON.stringify({ BROKER_EXECUTION_ENABLED: true, brokerExecutionEnabled: true, execution: { enabled: true } })), { TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true', ...(serverValue === undefined ? {} : { BROKER_EXECUTION_ENABLED: serverValue }) }, baseDeps({ executionDepsFactory: async () => { executionDepsCalls += 1; return {}; } }));
    const body = await response.json();
    assert.equal(body.execution.status, 'BROKER_EXECUTION_DISABLED');
    assert.equal(body.execution.executionEnabled, false);
    assert.equal(executionDepsCalls, 0);
  }
});
