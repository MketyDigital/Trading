import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomSignedApiProducer } from '../src/sources/nontelegram/custom_signed_api_producer.js';

const ENDPOINT = 'https://trading.example.com/api/v1/events';

function customEvent(overrides = {}) {
  return {
    eventId: 'evt-100',
    occurredAt: '2026-09-02T16:30:00.000Z',
    text: 'BUY XAUUSD NOW SL 2500 TP 2520',
    structuredPayload: { strategy: 'alpha', confidence: 0.9 },
    metadata: { origin: 'customer-app' },
    ...overrides,
  };
}

test('custom producer composes caller native event into signed V1 with authenticated source authority only', async () => {
  const requests = [];
  const producer = createCustomSignedApiProducer({
    endpoint: ENDPOINT,
    sourceId: 'custom-source-a',
    sourceSecret: 'secret-a',
    transport: async (request) => {
      requests.push(request);
      return { status: 200, body: JSON.stringify({ ok: true, duplicate: false }) };
    },
    nowMs: () => 1770001000000,
  });

  const result = await producer.publish(customEvent({
    workspace_id: 'attacker-workspace',
    source_connection_id: 'attacker-source',
    destination_id: 'broker-a',
    execution_enabled: true,
    metadata: {
      origin: 'customer-app',
      workspace_id: 'attacker-workspace',
      api_token: 'should-not-forward',
      destination_id: 'broker-a',
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  const request = requests[0];
  const body = JSON.parse(request.body);
  assert.equal(body.external_event_id, 'evt-100');
  assert.equal(body.occurred_at, '2026-09-02T16:30:00.000Z');
  assert.equal(body.text, 'BUY XAUUSD NOW SL 2500 TP 2520');
  assert.deepEqual(body.structured_payload, { strategy: 'alpha', confidence: 0.9 });
  assert.deepEqual(body.metadata.native_identity, { event_id: 'evt-100' });
  assert.equal(body.metadata.origin, 'customer-app');
  const serialized = JSON.stringify(body).toLowerCase();
  for (const forbidden of ['attacker-workspace', 'attacker-source', 'should-not-forward', 'broker-a', 'execution_enabled']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(request.headers['X-Mkety-Source-Id'], 'custom-source-a');
  assert.match(request.headers['X-Mkety-Signature'], /^v1=[0-9a-f]{64}$/);
});

test('invalid custom event fails before transport and cannot poison producer health with another event id', async () => {
  let calls = 0;
  const producer = createCustomSignedApiProducer({
    endpoint: ENDPOINT,
    sourceId: 'custom-source-a',
    sourceSecret: 'secret-a',
    transport: async () => { calls += 1; return { status: 200, body: '{"ok":true}' }; },
  });

  await assert.rejects(
    producer.publish(customEvent({ eventId: '', text: '', structuredPayload: null })),
    /SOURCE_NATIVE_EVENT_ID_REQUIRED|SOURCE_EVENT_CONTENT_REQUIRED/
  );
  assert.equal(calls, 0);
  assert.equal(producer.status().deliveryAttempts, 0);

  await producer.publish(customEvent({ eventId: 'evt-valid' }));
  assert.equal(calls, 1);
  assert.equal(producer.status().lastEventId, 'evt-valid');
});

test('duplicate response is terminal success and source-local retry does not rebuild caller event', async () => {
  const requests = [];
  const sleeps = [];
  let attempt = 0;
  const producer = createCustomSignedApiProducer({
    endpoint: ENDPOINT,
    sourceId: 'custom-source-a',
    sourceSecret: 'secret-a',
    retryDelaysMs: [10],
    sleep: async (ms) => { sleeps.push(ms); },
    nowMs: () => 1770001000000,
    transport: async (request) => {
      requests.push(request);
      attempt += 1;
      if (attempt === 1) return { status: 503, body: 'private failure' };
      return { status: 200, body: JSON.stringify({ ok: true, duplicate: true }) };
    },
  });

  const result = await producer.publish(customEvent());

  assert.equal(result.duplicate, true);
  assert.deepEqual(sleeps, [10]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(producer.status().deliveryAttempts, 2);
  assert.equal(producer.status().retryableFailures, 1);
  assert.equal(producer.status().deliverySuccesses, 1);
});

test('two custom producer instances keep credentials retry health and failures independent', async () => {
  let releaseA;
  const blockedA = new Promise((resolve) => { releaseA = resolve; });
  const requestsA = [];
  const requestsB = [];

  const a = createCustomSignedApiProducer({
    endpoint: ENDPOINT,
    sourceId: 'source-a',
    sourceSecret: 'secret-a',
    retryDelaysMs: [1],
    sleep: async () => blockedA,
    nowMs: () => 1770001000000,
    transport: async (request) => {
      requestsA.push(request);
      if (requestsA.length === 1) return { status: 503, body: 'A unavailable' };
      return { status: 200, body: '{"ok":true}' };
    },
  });
  const b = createCustomSignedApiProducer({
    endpoint: ENDPOINT,
    sourceId: 'source-b',
    sourceSecret: 'secret-b',
    nowMs: () => 1770001000000,
    transport: async (request) => {
      requestsB.push(request);
      return { status: 200, body: '{"ok":true}' };
    },
  });

  const aPending = a.publish(customEvent({ eventId: 'same-native-id' }));
  await Promise.resolve();
  const bResult = await b.publish(customEvent({ eventId: 'same-native-id' }));

  assert.equal(bResult.ok, true);
  assert.equal(b.status().status, 'healthy');
  assert.equal(b.status().deliverySuccesses, 1);
  assert.equal(a.status().status, 'degraded');
  assert.equal(a.status().deliverySuccesses, 0);
  assert.equal(requestsA[0].headers['X-Mkety-Source-Id'], 'source-a');
  assert.equal(requestsB[0].headers['X-Mkety-Source-Id'], 'source-b');
  assert.notEqual(requestsA[0].headers['X-Mkety-Signature'], requestsB[0].headers['X-Mkety-Signature']);

  releaseA();
  await aPending;
  assert.equal(a.status().deliverySuccesses, 1);
  assert.equal(b.status().deliverySuccesses, 1);
});

test('producer status is safe and configuration is immutable per instance', async () => {
  const producer = createCustomSignedApiProducer({
    endpoint: ENDPOINT,
    sourceId: 'source-a',
    sourceSecret: 'super-secret-value',
    transport: async () => ({ status: 200, body: '{"ok":true}' }),
  });
  await producer.publish(customEvent());

  const status = producer.status();
  const serialized = JSON.stringify(status).toLowerCase();
  assert.deepEqual(Object.keys(producer).sort(), ['publish', 'status']);
  for (const forbidden of ['super-secret-value', 'source-a', 'secret', 'token', 'credential', 'endpoint']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
