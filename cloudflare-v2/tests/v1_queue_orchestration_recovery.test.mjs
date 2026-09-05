import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1EventsRequest } from '../src/http/v1_events.js';
import { createSourceQueueRuntime } from '../src/sources/source_queue_runtime.js';

function request() {
  return new Request('https://trading.internal/api/v1/events', {
    method: 'POST',
    body: '{}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });
}

test('internal queue replay can re-orchestrate an authenticated duplicate using its persisted interpretation', async () => {
  let orchestrated = 0;
  const event = {
    workspace_hint: 'ws-1',
    source: { instance_id: 'src-1' },
    external_event_id: 'native-1',
    thread: {},
  };
  const interpretation = {
    status: 'READY',
    intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
  };

  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({
      ok: true,
      duplicate: true,
      recoveryReady: true,
      eventId: 'event-db-1',
      event,
      interpretation,
    }),
    orchestrateDuplicates: true,
    simulationDepsFactory: async () => ({ safe: true }),
    orchestrateFn: async () => {
      orchestrated += 1;
      return { status: 'SIMULATED', executionEnabled: false, actions: [], accounts: [] };
    },
  });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(orchestrated, 1);
  assert.equal(body.duplicate, true);
  assert.equal(body.simulation.status, 'SIMULATED');
});

test('public duplicate requests remain no-op even when event and interpretation are available', async () => {
  let orchestrated = 0;
  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({
      ok: true,
      duplicate: true,
      recoveryReady: true,
      eventId: 'event-db-1',
      event: { workspace_hint: 'ws-1' },
      interpretation: { status: 'READY' },
    }),
    simulationDepsFactory: async () => ({}),
    orchestrateFn: async () => {
      orchestrated += 1;
      return {};
    },
  });

  assert.equal(response.status, 200);
  assert.equal(orchestrated, 0);
  assert.equal((await response.json()).duplicate, true);
});

test('source queue retries instead of acknowledging an event whose orchestration is blocked', async () => {
  let acked = 0;
  let retried = 0;
  const batch = {
    messages: [{
      body: { version: 'mkety.source-event.v1', sourceId: 'src-1', event: { external_event_id: 'native-1', text: 'BUY XAUUSD' } },
      ack() { acked += 1; },
      retry() { retried += 1; },
    }],
  };

  const runtime = createSourceQueueRuntime({
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({
      sourceStore: {
        async getActiveSource() {
          return {
            id: 'src-1',
            workspace_id: 'ws-1',
            source_type: 'telegram',
            source_instance_id: 'src-1',
            source_family: 'telegram_mtproto',
            external_identity: 'telegram:1',
            secret: 'source-secret',
          };
        },
      },
      eventStore: {},
    }),
    eventsHandler: async (_request, _env, options) => {
      assert.equal(options.orchestrateDuplicates, true);
      return new Response(JSON.stringify({
        ok: true,
        duplicate: false,
        eventId: 'event-db-1',
        simulation: { status: 'BLOCKED', executionEnabled: false, actions: [] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    now: () => 1700000000000,
  });

  const result = await runtime(batch, { TRADING_MASTER_KEY: 'master' });
  assert.equal(acked, 0);
  assert.equal(retried, 1);
  assert.equal(result.acknowledged, 0);
  assert.equal(result.retried, 1);
});
