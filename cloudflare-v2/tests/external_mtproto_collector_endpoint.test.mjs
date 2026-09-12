import test from 'node:test';
import assert from 'node:assert/strict';

import { handleExternalMtprotoCollectorRequest } from '../src/http/external_mtproto_collector_endpoint.js';

function telegramBody(chatId = '-1003902892609', messageId = '221') {
  return JSON.stringify({
    chat_id: chatId,
    message_id: messageId,
    text: 'SELL XAUUSD NOW SL 3600 TP 3590',
  });
}

test('shared MTProto collector rejects unauthenticated transport before source lookup', async () => {
  let sourceLookups = 0;
  const response = await handleExternalMtprotoCollectorRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/collect', {
      method: 'POST',
      body: telegramBody(),
    }),
    {},
    {
      resolveCollector: async () => null,
      resolveSourcesForChat: async () => { sourceLookups += 1; return []; },
    },
  );

  assert.equal(response.status, 401);
  assert.equal(sourceLookups, 0);
  assert.equal((await response.json()).reason, 'EXTERNAL_MTPROTO_COLLECTOR_AUTH_REQUIRED');
});

test('shared MTProto collector accepts and ignores an authenticated unselected chat', async () => {
  let eventCalls = 0;
  const response = await handleExternalMtprotoCollectorRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/collect/collector-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: telegramBody('-1009999999999', '9'),
    }),
    {},
    {
      resolveCollector: async (token) => token === 'collector-token' ? { id: 'collector-1' } : null,
      resolveSourcesForChat: async (chatId) => {
        assert.equal(chatId, '-1009999999999');
        return [];
      },
      eventsHandler: async () => { eventCalls += 1; return new Response('{}'); },
    },
  );

  assert.equal(response.status, 202);
  assert.equal(eventCalls, 0);
  assert.deepEqual(await response.json(), {
    ok: true,
    accepted: true,
    ignored: true,
    chatId: '-1009999999999',
    matchedSources: 0,
    deliveredSources: 0,
  });
});

test('shared MTProto collector fans one Telegram message into each matching persisted source', async () => {
  const forwarded = [];
  const sources = [
    { id: 'source-a', workspace_id: 'workspace-a', provider_type: 'external_mtproto', secret: 'secret-a' },
    { id: 'source-b', workspace_id: 'workspace-b', provider_type: 'external_mtproto', secret: 'secret-b' },
  ];

  const response = await handleExternalMtprotoCollectorRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/collect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mkety-Collector-Token': 'collector-token',
      },
      body: telegramBody(),
    }),
    {},
    {
      resolveCollector: async (token) => token === 'collector-token' ? { id: 'collector-1' } : null,
      resolveSourcesForChat: async (chatId) => {
        assert.equal(chatId, '-1003902892609');
        return sources;
      },
      eventsHandler: async (request) => {
        forwarded.push({
          sourceId: request.headers.get('X-Mkety-Source-Id'),
          timestamp: request.headers.get('X-Mkety-Timestamp'),
          signature: request.headers.get('X-Mkety-Signature'),
          body: await request.json(),
        });
        return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
      },
      nowMs: () => 1770000000000,
    },
  );

  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.matchedSources, 2);
  assert.equal(body.deliveredSources, 2);
  assert.deepEqual(forwarded.map((item) => item.sourceId), ['source-a', 'source-b']);
  assert.ok(forwarded.every((item) => item.signature?.startsWith('v1=')));
  assert.ok(forwarded.every((item) => item.body.external_event_id === 'telegram:-1003902892609:221'));
  assert.ok(forwarded.every((item) => item.body.metadata.native_identity.chat_id === '-1003902892609'));
});

test('collector token in endpoint path works without per-source authentication headers', async () => {
  let seenToken = null;
  const response = await handleExternalMtprotoCollectorRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/collect/path-token', {
      method: 'POST', body: telegramBody(),
    }),
    {},
    {
      resolveCollector: async (token) => { seenToken = token; return { id: 'collector' }; },
      resolveSourcesForChat: async () => [],
    },
  );
  assert.equal(response.status, 202);
  assert.equal(seenToken, 'path-token');
});
