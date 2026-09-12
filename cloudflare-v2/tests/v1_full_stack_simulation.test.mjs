import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1EventsRequest } from '../src/http/v1_events.js';
import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';

function signedV1Request(body = {}) {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Source-Id': 'source-telegram-1',
      'X-Mkety-Timestamp': '1800000000000',
      'X-Mkety-Signature': 'v1=test-signature',
    },
  });
}

const canonicalEvent = {
  workspace_hint: 'workspace-live-shaped',
  external_event_id: 'telegram-msg-1001',
  source: { type: 'telegram_mtproto', instance_id: 'mtproto-listener-1' },
  text: 'BUY XAUUSD 2500 SL 2490 TP 2510 2520 2530',
  thread: { thread_id: 'gold-thread' },
};

const interpretation = {
  status: 'READY',
  intent: {
    side: 'BUY',
    orderType: 'MARKET',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 },
    stopLoss: 2490,
    takeProfits: [2510, 2520, 2530],
  },
};

const simulatedPlan = {
  status: 'SIMULATED',
  executionEnabled: false,
  correlation: { status: 'NEW_GROUP' },
  actions: [],
  accounts: [
    {
      accountId: 'mt5-demo-account',
      groupId: 'event-1001:mt5-demo-account',
      status: 'READY',
      actions: [
        {
          type: 'OPEN_POSITION',
          symbol: 'XAUUSD',
          side: 'BUY',
          orderType: 'MARKET',
          lots: 0.01,
          targetIndex: 1,
          stopLoss: 2490,
          takeProfit: 2510,
          simulated: true,
          transportMode: 'caller-forged-real',
        },
      ],
    },
  ],
};

const tradingAccessControlResolver = async () => ({ ok: true, enabled: true, reason: 'TEST_TRADING_ENABLED' });

test('V1 event request performs ingest, simulation planning and safe execution-stage handoff without broker network execution', async () => {
  const calls = {
    supabase: 0,
    simulationDeps: 0,
    orchestrate: 0,
    realDeps: 0,
    safeDeps: 0,
    productionExecute: 0,
  };
  let executionInput;
  let safeFactoryContext;

  const response = await handleV1EventsRequest(signedV1Request(canonicalEvent), {
    TRADING_MASTER_KEY: 'test-master-key',
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
    TRADING_EXECUTION_TRANSPORT_MODE: 'simulation',
  }, {
    supabaseFactory: async () => {
      calls.supabase += 1;
      return { from() { throw new Error('test supabase should not be queried directly'); } };
    },
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async ({ rawBody, sourceId, timestamp, signature }) => {
      assert.equal(sourceId, 'source-telegram-1');
      assert.equal(timestamp, '1800000000000');
      assert.equal(signature, 'v1=test-signature');
      assert.equal(JSON.parse(rawBody).external_event_id, 'telegram-msg-1001');
      return {
        ok: true,
        duplicate: false,
        eventId: 'db-event-1001',
        event: canonicalEvent,
        interpretation,
      };
    },
    simulationDepsFactory: async ({ env, event, interpretation: interpreted, eventId }) => {
      calls.simulationDeps += 1;
      assert.equal(env.TRADING_EXECUTION_TRANSPORT_MODE, 'simulation');
      assert.equal(event, canonicalEvent);
      assert.equal(interpreted, interpretation);
      assert.equal(eventId, 'db-event-1001');
      return { stateCoordinator: {}, stateStore: {}, accountProvider: async () => [] };
    },
    orchestrateFn: async ({ event, interpretation: interpreted, eventId }, deps) => {
      calls.orchestrate += 1;
      assert.equal(event, canonicalEvent);
      assert.equal(interpreted, interpretation);
      assert.equal(eventId, 'db-event-1001');
      assert.equal(typeof deps.accountProvider, 'function');
      return structuredClone(simulatedPlan);
    },
    tradingAccessControlResolver,
    brokerExecutionControlResolver: async () => ({
      ok: true,
      enabled: true,
      reason: 'TEST_ENABLED',
    }),
    executionDepsFactory: async () => {
      calls.realDeps += 1;
      throw new Error('real broker dependency factory must not be selected in simulation transport mode');
    },
    executionStageFn: async (stageInput) => runV1ProductionExecutionStage({
      ...stageInput,
      safeSimulationDepsFactory: async ({ env, workspaceId, tradingEventId }) => {
        calls.safeDeps += 1;
        safeFactoryContext = { env, workspaceId, tradingEventId };
        return { safeSimulationOnly: true };
      },
      executeProductionFn: async (input, deps) => {
        calls.productionExecute += 1;
        executionInput = structuredClone(input);
        assert.deepEqual(deps, { safeSimulationOnly: true, bindingRepairRecorder: deps.bindingRepairRecorder });
        return {
          executionEnabled: true,
          status: 'EXECUTED',
          succeeded: 1,
          failed: 0,
          accounts: [
            {
              accountId: input.accountPlans[0].accountId,
              status: 'SUCCESS',
              transport: 'safe-simulation',
            },
          ],
        };
      },
    }),
  });

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.eventId, 'db-event-1001');
  assert.equal(body.simulation.status, 'SIMULATED');
  assert.equal(body.simulation.executionEnabled, false);
  assert.equal(body.execution.status, 'EXECUTED');
  assert.equal(body.execution.transportMode, 'simulation');
  assert.equal(body.execution.succeeded, 1);

  assert.deepEqual(calls, {
    supabase: 1,
    simulationDeps: 1,
    orchestrate: 1,
    realDeps: 0,
    safeDeps: 1,
    productionExecute: 1,
  });

  assert.equal(safeFactoryContext.workspaceId, 'workspace-live-shaped');
  assert.equal(safeFactoryContext.tradingEventId, 'db-event-1001');
  assert.equal(executionInput.workspaceId, 'workspace-live-shaped');
  assert.equal(executionInput.eventId, 'db-event-1001');
  assert.equal(executionInput.brokerExecutionEnabled, true);
  assert.equal(executionInput.accountPlans.length, 1);
  assert.equal(executionInput.accountPlans[0].accountId, 'mt5-demo-account');
  assert.equal(executionInput.accountPlans[0].groupId, 'event-1001:mt5-demo-account');
  assert.equal(executionInput.accountPlans[0].actions.length, 1);
  assert.equal(executionInput.accountPlans[0].actions[0].type, 'OPEN_POSITION');
  assert.equal(executionInput.accountPlans[0].actions[0].simulated, undefined);
  assert.equal(executionInput.accountPlans[0].actions[0].transportMode, undefined);
});

test('V1 full stack safe simulation remains fail-closed when persisted broker owner switch is disabled', async () => {
  let productionExecuteCalled = false;

  const response = await handleV1EventsRequest(signedV1Request(canonicalEvent), {
    TRADING_MASTER_KEY: 'test-master-key',
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
    TRADING_EXECUTION_TRANSPORT_MODE: 'simulation',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({
      ok: true,
      duplicate: false,
      eventId: 'db-event-1002',
      event: canonicalEvent,
      interpretation,
    }),
    simulationDepsFactory: async () => ({}),
    orchestrateFn: async () => structuredClone(simulatedPlan),
    tradingAccessControlResolver,
    brokerExecutionControlResolver: async () => ({
      ok: true,
      enabled: false,
      reason: 'TEST_OWNER_DISABLED',
    }),
    executionStageFn: async (stageInput) => runV1ProductionExecutionStage({
      ...stageInput,
      safeSimulationDepsFactory: async () => {
        throw new Error('safe execution deps must not be built when persisted broker owner switch is disabled');
      },
      executeProductionFn: async () => {
        productionExecuteCalled = true;
      },
    }),
  });

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.simulation.status, 'SIMULATED');
  assert.equal(body.execution.status, 'BROKER_OWNER_SWITCH_OFF');
  assert.equal(body.execution.executionEnabled, false);
  assert.equal(body.execution.blocked, 1);
  assert.equal(body.execution.transportMode, 'simulation');
  assert.equal(productionExecuteCalled, false);
});
