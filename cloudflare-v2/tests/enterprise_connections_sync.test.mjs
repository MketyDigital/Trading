import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';
import { handleExternalMtprotoEndpointRequest } from '../src/http/external_mtproto_endpoint.js';

async function portalHtml() {
  const worker = createTradingV1Entrypoint({
    legacy: { async fetch() { return new Response('legacy'); } },
  });
  const response = await worker.fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  return response.text();
}

test('enterprise Connections UI exposes authoritative Telegram source filtering and activation', async () => {
  const html = await portalHtml();
  assert.match(html, /Telegram account scope/i);
  assert.match(html, /Allowed chat IDs/i);
  assert.match(html, /chat_acceptance_mode/);
  assert.match(html, /allowed_chat_ids/);
  assert.match(html, /data-source-toggle/);
  assert.match(html, /\/api\/v1\/admin\/sources\/.+enable/);
});

test('external MTProto UI exposes one source-bound endpoint and no separate source credentials', async () => {
  const html = await portalHtml();
  assert.match(html, /TRADING_ENDPOINT=/);
  assert.match(html, /\/api\/v1\/external\/mtproto\//);
  assert.match(html, /only value your external userbot needs/i);
  assert.doesNotMatch(html, /TRADING_SOURCE_ID=/);
  assert.doesNotMatch(html, /TRADING_SOURCE_SECRET=/);
  assert.doesNotMatch(html, /ALLOWED_CHAT_IDS=/);
});

test('external MTProto endpoint converts endpoint possession into internal signed V1 ingress', async () => {
  let forwarded = null;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/opaque-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ external_event_id: 'evt-1', text: 'BUY XAUUSD' }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => ({
        id: 'source-1',
        provider_type: 'external_mtproto',
        secret: 'opaque-secret',
      }),
      nowMs: () => 1770000000000,
      eventsHandler: async (request) => {
        forwarded = {
          sourceId: request.headers.get('X-Mkety-Source-Id'),
          timestamp: request.headers.get('X-Mkety-Timestamp'),
          signature: request.headers.get('X-Mkety-Signature'),
          body: await request.text(),
        };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.sourceId, 'source-1');
  assert.equal(forwarded.timestamp, '1770000000000');
  assert.match(forwarded.signature, /^v1=[a-f0-9]{64}$/);
  assert.match(forwarded.body, /BUY XAUUSD/);
});

test('generated MTProto endpoint normalizes authenticated Telegram identity without fabricating it', async () => {
  for (const payload of [
    { external_event_id: 'telegram:-10012345:9876', text: 'BUY XAUUSD' },
    { external_event_id: 'evt-external', chat_id: '-10012345', message_id: 9876, text: 'BUY XAUUSD' },
  ]) {
    let forwardedBody = null;
    const response = await handleExternalMtprotoEndpointRequest(
      new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/opaque-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      { TRADING_MASTER_KEY: 'master' },
      {
        resolveActiveSource: async () => ({
          id: 'source-1',
          provider_type: 'external_mtproto',
          secret: 'opaque-secret',
        }),
        eventsHandler: async (request) => {
          forwardedBody = JSON.parse(await request.text());
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(forwardedBody.metadata.native_identity, {
      chat_id: '-10012345',
      message_id: '9876',
    });
  }
});

test('external MTProto endpoint rejects a wrong opaque endpoint token before V1 processing', async () => {
  let called = false;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/wrong-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => ({
        id: 'source-1',
        provider_type: 'external_mtproto',
        secret: 'correct-token',
      }),
      eventsHandler: async () => { called = true; return new Response('{}'); },
    },
  );

  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test('enterprise AI setup requires explicit provider model IDs and contains no stale fallback model defaults', async () => {
  const html = await portalHtml();
  assert.match(html, /Enter the current provider model ID/i);
  assert.doesNotMatch(html, /gpt-4o-mini/i);
  assert.doesNotMatch(html, /gpt-5-mini/i);
  assert.doesNotMatch(html, /gemini-2\.5-flash/i);
  assert.doesNotMatch(html, /deepseek-chat/i);
  assert.doesNotMatch(html, /llama-3\.3-70b-instruct/i);
});