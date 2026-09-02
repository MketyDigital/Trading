import test from 'node:test';
import assert from 'node:assert/strict';

import { verifySignedSourcePayload } from '../src/security/source_auth.js';
import {
  createSignedV1SourceClient,
  PermanentSourceDeliveryError,
  RetryableSourceDeliveryError,
} from '../src/sources/nontelegram/signed_v1_client.js';

const NOW = 1_788_368_400_000;

function samplePayload(id = 'event-1') {
  return {
    external_event_id: id,
    occurred_at: '2026-09-02T15:00:00.000Z',
    text: 'BUY XAUUSD 2500 SL 2490 TP 2520',
    metadata: { native_identity: { transaction_id: id } },
  };
}

test('client signs exact serialized V1 body with only source auth headers', async () => {
  const calls = [];
  const client = createSignedV1SourceClient({
    endpoint: 'https://trading.example.com/api/v1/events',
    sourceId: 'src-mt5-a',
    sourceSecret: 'source-secret',
    nowMs: () => NOW,
    transport: async (request) => {
      calls.push(request);
      return { status: 200, body: JSON.stringify({ ok: true, duplicate: false, eventId: 'evt-1' }) };
    },
  });

  const result = await client.send(samplePayload());

  assert.deepEqual(result, { ok: true, duplicate: false, eventId: 'evt-1' });
  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://trading.example.com/api/v1/events');
  assert.deepEqual(Object.keys(request.headers).sort(), [
    'Content-Type',
    'X-Mkety-Signature',
    'X-Mkety-Source-Id',
    'X-Mkety-Timestamp',
  ].sort());
  assert.equal(request.headers['X-Mkety-Source-Id'], 'src-mt5-a');
  assert.equal(request.headers['X-Mkety-Timestamp'], String(NOW));
  assert.equal(request.body, JSON.stringify(samplePayload()));

  const verified = await verifySignedSourcePayload({
    rawBody: request.body,
    sourceId: request.headers['X-Mkety-Source-Id'],
    timestamp: request.headers['X-Mkety-Timestamp'],
    signature: request.headers['X-Mkety-Signature'],
    secret: 'source-secret',
    nowMs: NOW,
  });
  assert.equal(verified.ok, true);
});

test('duplicate response is terminal success and never asks transport to retry', async () => {
  let calls = 0;
  const client = createSignedV1SourceClient({
    endpoint: 'https://trading.example.com/api/v1/events',
    sourceId: 'src-custom-a',
    sourceSecret: 'secret-a',
    nowMs: () => NOW,
    transport: async () => {
      calls += 1;
      return { status: 200, body: JSON.stringify({ ok: true, duplicate: true, eventId: 'evt-existing' }) };
    },
  });

  const result = await client.send(samplePayload('event-2'));
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(calls, 1);
});

test('network, 429 and 5xx failures are retryable while other non-2xx failures are permanent', async () => {
  const clientFor = (response) => createSignedV1SourceClient({
    endpoint: 'https://trading.example.com/api/v1/events',
    sourceId: 'src-a',
    sourceSecret: 'secret-a',
    nowMs: () => NOW,
    transport: typeof response === 'function' ? response : async () => response,
  });

  await assert.rejects(
    () => clientFor(async () => { throw new Error('network detail must not leak'); }).send(samplePayload()),
    (error) => error instanceof RetryableSourceDeliveryError && error.code === 'NETWORK_ERROR',
  );
  await assert.rejects(
    () => clientFor({ status: 429, body: 'rate limited details' }).send(samplePayload()),
    (error) => error instanceof RetryableSourceDeliveryError && error.status === 429,
  );
  await assert.rejects(
    () => clientFor({ status: 503, body: 'upstream internals' }).send(samplePayload()),
    (error) => error instanceof RetryableSourceDeliveryError && error.status === 503,
  );
  await assert.rejects(
    () => clientFor({ status: 403, body: 'auth internals' }).send(samplePayload()),
    (error) => error instanceof PermanentSourceDeliveryError && error.status === 403,
  );
});

test('invalid 2xx response is permanent and errors never contain secrets or response bodies', async () => {
  const secret = 'top-secret-source-value';
  const client = createSignedV1SourceClient({
    endpoint: 'https://trading.example.com/api/v1/events',
    sourceId: 'src-a',
    sourceSecret: secret,
    nowMs: () => NOW,
    transport: async () => ({ status: 200, body: `bad-json-${secret}` }),
  });

  await assert.rejects(
    () => client.send(samplePayload()),
    (error) => {
      const rendered = `${error.name}:${error.message}:${JSON.stringify(error)}`;
      return error instanceof PermanentSourceDeliveryError
        && error.code === 'INVALID_RESPONSE'
        && !rendered.includes(secret)
        && !rendered.includes('bad-json');
    },
  );
});

test('client configuration fails closed and each instance retains independent credentials', async () => {
  assert.throws(
    () => createSignedV1SourceClient({ endpoint: 'http://trading.example.com/api/v1/events', sourceId: 'a', sourceSecret: 'a' }),
    /SOURCE_ENDPOINT_INVALID/,
  );
  assert.throws(
    () => createSignedV1SourceClient({ endpoint: 'https://trading.example.com/api/other', sourceId: 'a', sourceSecret: 'a' }),
    /SOURCE_ENDPOINT_INVALID/,
  );

  const seen = [];
  const transport = async (request) => {
    seen.push(request);
    return { status: 200, body: JSON.stringify({ ok: true, duplicate: false }) };
  };
  const a = createSignedV1SourceClient({ endpoint: 'https://trading.example.com/api/v1/events', sourceId: 'source-a', sourceSecret: 'secret-a', nowMs: () => NOW, transport });
  const b = createSignedV1SourceClient({ endpoint: 'https://trading.example.com/api/v1/events', sourceId: 'source-b', sourceSecret: 'secret-b', nowMs: () => NOW, transport });

  await Promise.all([a.send(samplePayload('a-1')), b.send(samplePayload('b-1'))]);
  assert.deepEqual(seen.map((request) => request.headers['X-Mkety-Source-Id']).sort(), ['source-a', 'source-b']);
  assert.equal(JSON.stringify(a).includes('secret-a'), false);
  assert.equal(JSON.stringify(b).includes('secret-b'), false);
});
