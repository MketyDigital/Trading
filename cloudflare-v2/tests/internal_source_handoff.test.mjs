import test from 'node:test';
import assert from 'node:assert/strict';

import { handleInternalSourceEventRequest } from '../src/http/internal_source_event.js';

function request(body, token = 'transport-token') {
  return new Request('https://trade.mkety.com/api/v1/internal/source-event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Internal-Source-Token': token,
    },
    body: JSON.stringify(body),
  });
}

const nativeTelegramEvent = {
  source_id: 'src-telegram-1',
  source_external_id: 'telegram-account-42',
  external_event_id: 'telegram:-100100:77',
  occurred_at: '2026-09-02T07:00:00.000Z',
  text: 'BUY GOLD NOW',
  thread: {
    thread_id: 'topic-10',
    reply_to_event_id: '76',
    edited_event_id: null,
  },
  metadata: {
    native_identity: { chat_id: '-100100', message_id: '77' },
    account_scope: 'telegram-account-42',
  },
};

test('trusted first-party handoff validates transport token then queues compact native event without source HMAC', async () => {
  const sent = [];
  const response = await handleInternalSourceEventRequest(
    request(nativeTelegramEvent),
    {
      INTERNAL_SOURCE_TRANSPORT_TOKEN: 'transport-token',
      SOURCE_EVENT_QUEUE: { async send(value) { sent.push(value); } },
    },
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, queued: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sourceId, 'src-telegram-1');
  assert.equal(sent[0].event.external_event_id, 'telegram:-100100:77');
  assert.equal(sent[0].event.thread.reply_to_event_id, '76');
  assert.equal(JSON.stringify(sent[0]).includes('transport-token'), false);
  assert.equal(JSON.stringify(sent[0]).includes('hmac'), false);
  assert.equal(JSON.stringify(sent[0]).includes('secret'), false);
});

test('trusted handoff fails closed for bad token, missing queue, unsupported methods or malformed native identity', async () => {
  const baseEnv = {
    INTERNAL_SOURCE_TRANSPORT_TOKEN: 'transport-token',
    SOURCE_EVENT_QUEUE: { async send() { throw new Error('must not send'); } },
  };

  assert.equal((await handleInternalSourceEventRequest(request(nativeTelegramEvent, 'wrong'), baseEnv)).status, 401);

  assert.equal((await handleInternalSourceEventRequest(request(nativeTelegramEvent), {
    INTERNAL_SOURCE_TRANSPORT_TOKEN: 'transport-token',
  })).status, 503);

  const get = new Request('https://trade.mkety.com/api/v1/internal/source-event', {
    method: 'GET',
    headers: { 'X-Mkety-Internal-Source-Token': 'transport-token' },
  });
  assert.equal((await handleInternalSourceEventRequest(get, baseEnv)).status, 405);

  const bad = { ...nativeTelegramEvent, metadata: { native_identity: { chat_id: '-100100' } } };
  assert.equal((await handleInternalSourceEventRequest(request(bad), baseEnv)).status, 400);
});

test('queue failure returns retryable 503 and never claims delivery', async () => {
  const response = await handleInternalSourceEventRequest(request(nativeTelegramEvent), {
    INTERNAL_SOURCE_TRANSPORT_TOKEN: 'transport-token',
    SOURCE_EVENT_QUEUE: { async send() { throw new Error('queue unavailable'); } },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, reason: 'SOURCE_QUEUE_UNAVAILABLE' });
});
