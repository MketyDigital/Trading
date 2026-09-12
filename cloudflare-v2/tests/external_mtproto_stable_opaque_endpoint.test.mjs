import test from 'node:test';
import assert from 'node:assert/strict';

import { handleExternalMtprotoEndpointRequest } from '../src/http/external_mtproto_endpoint.js';

test('external MTProto source-id URL accepts ordinary Telegram payloads without Mkety auth headers', async () => {
  let forwarded = null;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: '-1003902892609',
        message_id: 222,
        text: 'BUY XAUUSD NOW',
      }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async (sourceId) => {
        assert.equal(sourceId, 'source-1');
        return {
          id: 'source-1',
          provider_type: 'external_mtproto',
          secret: 'legacy-secret-still-supported',
          config: {
            chat_acceptance_mode: 'allowlist',
            allowed_chat_ids: ['-1003902892609'],
          },
        };
      },
      eventsHandler: async (request) => {
        forwarded = {
          headers: Object.fromEntries(request.headers.entries()),
          body: JSON.parse(await request.text()),
        };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.body.text, 'BUY XAUUSD NOW');
  assert.equal(forwarded.body.external_event_id, 'telegram:-1003902892609:222');
  assert.deepEqual(forwarded.body.metadata.native_identity, {
    chat_id: '-1003902892609',
    message_id: '222',
  });
  assert.equal(forwarded.headers['x-mkety-source-id'], 'source-1');
  assert.ok(forwarded.headers['x-mkety-signature']);
});

test('legacy external MTProto URL with embedded secret remains supported', async () => {
  let forwarded = false;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/legacy-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '-1003902892609', message_id: 223, text: 'SELL XAUUSD NOW' }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => ({
        id: 'source-1',
        provider_type: 'external_mtproto',
        secret: 'legacy-secret',
      }),
      eventsHandler: async () => {
        forwarded = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded, true);
});

test('wrong explicit legacy secret is still rejected instead of silently falling back to source-id capability', async () => {
  let forwarded = false;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/wrong-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '-1003902892609', message_id: 224, text: 'BUY XAUUSD NOW' }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => ({
        id: 'source-1',
        provider_type: 'external_mtproto',
        secret: 'legacy-secret',
      }),
      eventsHandler: async () => {
        forwarded = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 401);
  assert.equal(forwarded, false);
  assert.deepEqual(await response.json(), { ok: false, reason: 'INVALID_EXTERNAL_MTPROTO_ENDPOINT' });
});
