import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1EventsRequest } from '../src/http/v1_events.js';

test('rejects non-POST methods and missing source authentication headers', async () => {
  const get = await handleV1EventsRequest(new Request('https://trade.test/api/v1/events'), {}, {});
  assert.equal(get.status, 405);

  const missing = await handleV1EventsRequest(new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
  }), {}, {});
  assert.equal(missing.status, 401);
});

test('passes exact raw body and signed source headers into persistent ingest pipeline', async () => {
  let captured;
  const rawBody = '{"external_event_id":"tv-1","text":"BUY GOLD NOW"}';
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1700000000000',
      'X-Mkety-Signature': 'v1=abc',
    },
  });

  const response = await handleV1EventsRequest(request, { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    workspaceAiFactory: async () => ({ processSignal() {} }),
    ingestFn: async (input, dependencies) => {
      captured = { input, dependencies };
      return { ok: true, duplicate: false, eventId: 'evt-1', interpretation: { status: 'READY' } };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(captured.input.rawBody, rawBody);
  assert.equal(captured.input.sourceId, 'src-1');
  assert.equal(captured.input.timestamp, '1700000000000');
  assert.equal(captured.input.signature, 'v1=abc');
  assert.equal(typeof captured.dependencies.aiRouterFactory, 'function');
  const body = await response.json();
  assert.equal(body.eventId, 'evt-1');
});

test('preserves ingest authorization and validation status codes', async () => {
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: {
      'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'bad',
    },
  });
  const response = await handleV1EventsRequest(request, { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: false, status: 401, reason: 'INVALID_SIGNATURE' }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reason, 'INVALID_SIGNATURE');
});

test('fails closed when required server-side encryption configuration is absent', async () => {
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: {
      'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'sig',
    },
  });
  const response = await handleV1EventsRequest(request, {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'TRADING_MASTER_KEY_NOT_CONFIGURED');
});
