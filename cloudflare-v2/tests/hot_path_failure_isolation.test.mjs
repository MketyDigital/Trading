import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';
import { dispatchDestinationFanout } from '../src/destinations/destination_fanout.js';
import { executeMT5Action } from '../src/adapters/mt5_executor_v2.js';
import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';
import { createRuntimeExecutionSnapshotCache } from '../src/execution/runtime_execution_snapshot.js';
import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';
import { handleV1EventsRequest } from '../src/http/v1_events.js';

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

function action(overrides = {}) {
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
    actions: [action()],
    ...overrides,
  };
}

function signedRequest(body = '{}') {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });
}

function successfulIngest(overrides = {}) {
  return {
    ok: true,
    duplicate: false,
    eventId: 'db-event-1',
    event: {
      workspace_hint: 'ws-a',
      external_event_id: 'evt-1',
      source: { instance_id: 'src-1' },
      thread: {},
    },
    interpretation: {
      status: 'READY',
      intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
    },
    ...overrides,
  };
}

function simulatedReadyAccount() {
  return {
    status: 'SIMULATED',
    executionEnabled: false,
    actions: [],
    accounts: [{
      accountId: 'acct-a',
      status: 'READY',
      groupId: 'group-a',
      actions: [{ ...action(), simulated: true }],
    }],
  };
}

test('AI and telemetry outages cannot enter the deterministic broker hot path', async () => {
  let aiCalls = 0;
  const interpretation = await interpretTradingEvent({
    text: 'BUY XAUUSD 2526 SL 2518 TP 2530 2535',
  }, {
    aiRouter: {
      processSignal: async () => {
        aiCalls += 1;
        throw new Error('AI unavailable');
      },
    },
  });

  assert.equal(interpretation.status, 'READY');
  assert.equal(interpretation.source, 'deterministic');
  assert.equal(aiCalls, 0);

  let brokerCalls = 0;
  const result = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', accountPlans: [plan()], brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => {
      brokerCalls += 1;
      return { ok: true };
    },
    latencyTrace: {
      mark() { throw new Error('telemetry unavailable'); },
    },
  });

  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(brokerCalls, 1);
});

test('ambiguity AI outage degrades to review and cannot construct broker dependencies', async () => {
  const interpretation = await interpretTradingEvent({
    text: 'gold looks good maybe buy around here',
  }, {
    aiRouter: {
      processSignal: async () => { throw new Error('AI unavailable'); },
    },
  });
  assert.equal(interpretation.status, 'NEEDS_REVIEW');

  let dependencyCalls = 0;
  let brokerCalls = 0;
  const execution = await runV1ProductionExecutionStage({
    env: { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    supabase: {},
    result: successfulIngest({ interpretation }),
    simulation: { status: 'NEEDS_REVIEW', executionEnabled: false, accounts: [], actions: [] },
    executionDepsFactory: async () => { dependencyCalls += 1; return {}; },
    executeProductionFn: async () => { brokerCalls += 1; return {}; },
  });

  assert.equal(execution.status, 'NOT_EXECUTABLE');
  assert.equal(dependencyCalls, 0);
  assert.equal(brokerCalls, 0);
});

test('Telegram formatting/send failure is destination-local and cannot cancel healthy broker execution', async () => {
  const destination = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: [{
      id: 'telegram-a',
      workspace_id: 'ws-a',
      type: 'telegram',
      presentation: { useAi: true },
    }],
    event: { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } },
    aiFormatter: async () => { throw new Error('formatter unavailable'); },
    dispatch: async () => { throw new Error('Telegram unavailable'); },
  });
  assert.equal(destination.failed, 1);

  let brokerCalls = 0;
  const broker = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', accountPlans: [plan()], brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => { brokerCalls += 1; return { ok: true }; },
  });

  assert.equal(broker.status, 'SUCCEEDED');
  assert.equal(brokerCalls, 1);
});

test('database/config planning outage fails closed before broker dependency construction', async () => {
  let executionDepsCalls = 0;
  let brokerCalls = 0;
  const response = await handleV1EventsRequest(signedRequest(), {
    TRADING_MASTER_KEY: 'master',
    TRADING_V1_SIMULATION: 'true',
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => successfulIngest(),
    simulationDepsFactory: async () => { throw new Error('configuration database unavailable'); },
    executionDepsFactory: async () => { executionDepsCalls += 1; return {}; },
    executeProductionFn: async () => { brokerCalls += 1; return {}; },
  });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.simulation.status, 'BLOCKED');
  assert.equal(body.execution.status, 'NOT_EXECUTABLE');
  assert.equal(executionDepsCalls, 0);
  assert.equal(brokerCalls, 0);
});

test('fresh authoritative account load overrides stale enabled snapshot authority', async () => {
  let now = 0;
  const cache = createRuntimeExecutionSnapshotCache({ ttlMs: 1, clock: () => now });
  cache.put({
    workspaceId: 'ws-a', sourceId: 'src-1', accountId: 'acct-a', version: 'v1',
    accountActive: true, executionEnabled: true, safetyPolicy: { enabled: true, killSwitch: false },
  });
  now = 2;
  assert.equal(cache.get({ workspaceId: 'ws-a', sourceId: 'src-1', accountId: 'acct-a', version: 'v1' }), null);

  let brokerCalls = 0;
  const result = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', accountPlans: [plan()], brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account({ execution_enabled: false }),
    dispatchAction: async () => { brokerCalls += 1; return { ok: true }; },
  });

  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.equal(result.accounts[0].reason, 'ACCOUNT_EXECUTION_DISABLED');
  assert.equal(brokerCalls, 0);
});

test('persistent idempotency reservation failure blocks MT5 transport before broker send', async () => {
  let transportCalls = 0;
  await assert.rejects(() => executeMT5Action(action(), {
    workspaceId: 'ws-a',
    accountId: '90001',
    bridgeUrl: 'https://bridge.test/v1/command',
    bridgeSecret: 'secret',
    deliveryStore: {
      reserve: async () => ({ ok: false, duplicate: false }),
      complete: async () => {},
      fail: async () => {},
    },
    fetchFn: async () => {
      transportCalls += 1;
      throw new Error('must not send');
    },
  }), /reserve MT5 delivery idempotency/i);
  assert.equal(transportCalls, 0);
});

test('broker fuse, kill switch, and disabled account each block dispatch', async () => {
  const cases = [
    {
      name: 'broker fuse',
      brokerExecutionEnabled: false,
      row: account(),
      reason: 'BROKER_EXECUTION_DISABLED',
    },
    {
      name: 'kill switch',
      brokerExecutionEnabled: true,
      row: account({ safety_policy: { enabled: true, killSwitch: true } }),
      reason: 'ACCOUNT_POLICY_BLOCKED',
    },
    {
      name: 'account disabled',
      brokerExecutionEnabled: true,
      row: account({ is_active: false }),
      reason: 'ACCOUNT_INACTIVE',
    },
  ];

  for (const item of cases) {
    let brokerCalls = 0;
    const result = await executeProductionPlan({
      workspaceId: 'ws-a', eventId: 'evt-1', accountPlans: [plan()],
      brokerExecutionEnabled: item.brokerExecutionEnabled,
    }, {
      accountLoader: async () => item.row,
      dispatchAction: async () => { brokerCalls += 1; return { ok: true }; },
    });

    assert.equal(result.accounts[0].status, 'BLOCKED', item.name);
    assert.equal(result.accounts[0].reason, item.reason, item.name);
    assert.equal(brokerCalls, 0, item.name);
  }
});

test('uncertain broker outcome is never blindly retried inside the coordinator', async () => {
  let brokerCalls = 0;
  const uncertain = new Error('broker outcome uncertain');
  uncertain.failureClass = 'UNCERTAIN';

  const result = await executeProductionPlan({
    workspaceId: 'ws-a', eventId: 'evt-1', accountPlans: [plan()], brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => {
      brokerCalls += 1;
      throw uncertain;
    },
  });

  assert.equal(result.accounts[0].status, 'FAILED');
  assert.equal(result.accounts[0].reason, 'ACCOUNT_ACTION_FAILED');
  assert.equal(result.accounts[0].actions[0].reason, 'BROKER_DISPATCH_FAILED');
  assert.equal(brokerCalls, 1);
});

test('duplicate replay and front-door rejection cannot reach planning or broker execution', async () => {
  let supabaseCalls = 0;
  let planningCalls = 0;
  let brokerCalls = 0;

  const rejected = await handleV1EventsRequest(new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
  }), { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => { supabaseCalls += 1; return {}; },
  });
  assert.equal(rejected.status, 401);
  assert.equal(supabaseCalls, 0);

  const duplicate = await handleV1EventsRequest(signedRequest(), {
    TRADING_MASTER_KEY: 'master',
    TRADING_V1_SIMULATION: 'true',
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => successfulIngest({ duplicate: true }),
    simulationDepsFactory: async () => { planningCalls += 1; return {}; },
    executeProductionFn: async () => { brokerCalls += 1; return {}; },
  });

  const body = await duplicate.json();
  assert.equal(duplicate.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(body.simulation, undefined);
  assert.equal(body.execution, undefined);
  assert.equal(planningCalls, 0);
  assert.equal(brokerCalls, 0);
});
