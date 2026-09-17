import test from 'node:test';
import assert from 'node:assert/strict';
import { handleExternalMtprotoEndpointRequest } from '../src/http/external_mtproto_endpoint.js';

function activeSource() {
  return {
    id: 'source-1',
    provider_type: 'external_mtproto',
    secret: 'opaque-secret',
  };
}

test('generated MTProto endpoint derives external_event_id from Telegram chat/message identity', async () => {
  let forwarded = null;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/opaque-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: '-1003902892609', message_id: 219, text: 'BUY XAUUSD' }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => activeSource(),
      eventsHandler: async (request) => {
        forwarded = JSON.parse(await request.text());
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.external_event_id, 'telegram:-1003902892609:219');
  assert.deepEqual(forwarded.metadata.native_identity, {
    chat_id: '-1003902892609',
    message_id: '219',
  });
});

test('source-specific MTProto endpoint promotes legacy reply_to_id into canonical Telegram reply lineage', async () => {
  let forwarded = null;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/opaque-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: '-1004387586337',
        message_id: 902,
        reply_to_id: 901,
        text: 'SL at BE NOW',
        account_id: 1,
      }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => activeSource(),
      eventsHandler: async (request) => {
        forwarded = JSON.parse(await request.text());
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.external_event_id, 'telegram:-1004387586337:902');
  assert.equal(forwarded.thread.reply_to_event_id, 'telegram:-1004387586337:901');
});

test('source-specific MTProto endpoint promotes additive edit marker into canonical same-message edit lineage', async () => {
  let forwarded = null;
  const response = await handleExternalMtprotoEndpointRequest(
    new Request('https://trade.mkety.com/api/v1/external/mtproto/source-1/opaque-secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: '-1002366787615',
        message_id: 321,
        reply_to_id: 320,
        text: 'SELL GOLD SL 4320 TP 4280',
        edited: true,
        account_id: 1,
      }),
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      resolveActiveSource: async () => activeSource(),
      eventsHandler: async (request) => {
        forwarded = JSON.parse(await request.text());
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded.external_event_id, 'telegram:-1002366787615:321');
  assert.equal(forwarded.thread.reply_to_event_id, 'telegram:-1002366787615:320');
  assert.equal(forwarded.thread.edited_event_id, 'telegram:-1002366787615:321');
});
