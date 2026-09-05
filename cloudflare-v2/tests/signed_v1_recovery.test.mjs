import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSignedV1SourceClient,
  RetryableSourceDeliveryError,
} from '../src/sources/nontelegram/signed_v1_client.js';
import { handleV1EventsRequest } from '../src/http/v1_events.js';

test('signed source runtime marks requests for duplicate recovery', async () => {
  let captured;
  const client = createSignedV1SourceClient({
    endpoint: 'https://trade.mkety.com/api/v1/events',
    sourceId: 'src-1',
    sourceSecret: 'secret',
    nowMs: () => 1700000000000,
    transport: async (request) => {
      captured = request;
      return { status: 200, body: JSON.stringify({ ok: true, simulation: { status: 'SIMULATED' } }) };
    },
  });

  await client.send({ external_event_id: 'native-1' });
  assert.equal(captured.headers['X-Mkety-Source-Recovery'], '1');
});

test('signed source runtime treats blocked orchestration as retryable delivery', async () => {
  const client = createSignedV1SourceClient({
    endpoint: 'https://trade.mkety.com/api/v1/events',
    sourceId: 'src-1',
    sourceSecret: 'secret',
    nowMs: () => 1700000000000,
    transport: async () => ({
      status: 200,
      body: JSON.stringify({
        ok: true,
        simulation: { status: 'BLOCKED', error: 'state dependency unavailable' },
      }),
    }),
  });

  await assert.rejects(
    () => client.send({ external_event_id: 'native-1' }),
    (error) => error instanceof RetryableSourceDeliveryError && error.code === 'ORCHESTRATION_BLOCKED',
  );
});

test('authenticated recovery-marked duplicate re-enters orchestration while ordinary duplicate stays no-op', async () => {
  let calls = 0;
  const makeRequest = (recovery) => new Request('https://trade.mkety.com/api/v1/events', {
    method: 'POST',
    body: '{}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
      ...(recovery ? { 'X-Mkety-Source-Recovery': '1' } : {}),
    },
  });
  const deps = {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({
      ok: true,
      duplicate: true,
      eventId: 'evt-1',
      event: { workspace_hint: 'ws-1' },
      interpretation: { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } },
    }),
    simulationDepsFactory: async () => ({}),
    orchestrateFn: async () => {
      calls += 1;
      return { status: 'SIMULATED', executionEnabled: false, actions: [], accounts: [] };
    },
  };

  await handleV1EventsRequest(makeRequest(false), { TRADING_MASTER_KEY: 'master' }, deps);
  assert.equal(calls, 0);

  const recoveryResponse = await handleV1EventsRequest(makeRequest(true), { TRADING_MASTER_KEY: 'master' }, deps);
  assert.equal(recoveryResponse.status, 200);
  assert.equal(calls, 1);
  assert.equal((await recoveryResponse.json()).simulation.status, 'SIMULATED');
});
