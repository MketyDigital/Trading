import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1EventsRequest } from '../src/http/v1_events.js';

function request(headers = {}) {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: '{"external_event_id":"evt-1","text":"BUY XAUUSD NOW"}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
      ...headers,
    },
  });
}

const event = {
  workspace_hint: 'ws-1',
  external_event_id: 'evt-1',
  text: 'BUY XAUUSD NOW',
  source: { instance_id: 'source-instance-1' },
  thread: {},
};
const interpretation = {
  status: 'READY',
  intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' }, orderType: 'MARKET', entry: { kind: 'MARKET' }, takeProfits: [] },
};

function dependencies(overrides = {}) {
  return {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: true, duplicate: false, eventId: 'db-event-1', event, interpretation }),
    simulationDepsFactory: async () => ({}),
    orchestrateFn: async () => ({ status: 'NO_ACTION', executionEnabled: false, actions: [], accounts: [] }),
    executionStageFn: async () => ({ status: 'TRADING_ACCESS_DISABLED', executionEnabled: false }),
    ...overrides,
  };
}

test('fresh authenticated event invokes destination stage with trusted workspace/source authority', async () => {
  let captured;
  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
    BROKER_EXECUTION_ENABLED: 'false',
  }, dependencies({
    destinationStoreFactory: (supabase) => ({ supabaseMarker: supabase }),
    destinationStageFn: async (input, deps) => {
      captured = { input, deps };
      return { status: 'DELIVERED', succeeded: 1, failed: 0, rejected: 0, blocked: 0, outcomes: [{ destinationId: 'dest-1', status: 'SUCCEEDED' }] };
    },
  }));

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(captured.input.workspaceId, 'ws-1');
  assert.equal(captured.input.sourceId, 'src-1');
  assert.equal(captured.input.event, event);
  assert.equal(captured.input.interpretation, interpretation);
  assert.equal(captured.input.env.BROKER_EXECUTION_ENABLED, 'false');
  assert.ok(captured.deps.destinationStore.supabaseMarker);
  assert.equal(body.destinations.status, 'DELIVERED');
  assert.equal(body.destinations.succeeded, 1);
});

test('duplicate recovery never re-sends external destinations', async () => {
  let destinationCalls = 0;
  const response = await handleV1EventsRequest(request({ 'X-Mkety-Source-Recovery': '1' }), {
    TRADING_MASTER_KEY: 'master',
    BROKER_EXECUTION_ENABLED: 'false',
  }, dependencies({
    ingestFn: async () => ({ ok: true, duplicate: true, recoveryReady: true, eventId: 'db-event-1', event, interpretation }),
    destinationStoreFactory: () => ({}),
    destinationStageFn: async () => {
      destinationCalls += 1;
      return { status: 'DELIVERED', succeeded: 1, outcomes: [] };
    },
  }));

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(destinationCalls, 0);
  assert.equal(body.duplicate, true);
  assert.equal(body.destinations.status, 'SKIPPED_DUPLICATE');
  assert.equal(body.destinations.succeeded, 0);
});

test('destination-stage failure cannot turn accepted ingress into an error or enable broker execution', async () => {
  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
    BROKER_EXECUTION_ENABLED: 'false',
  }, dependencies({
    destinationStoreFactory: () => ({}),
    destinationStageFn: async () => { throw new Error('synthetic destination failure'); },
  }));

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.destinations.status, 'BLOCKED');
  assert.equal(body.destinations.errorCode, 'DESTINATION_STAGE_FAILED');
  assert.equal(body.execution.executionEnabled, false);
  assert.equal(JSON.stringify(body).includes('synthetic destination failure'), false);
});