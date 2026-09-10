import test from 'node:test';
import assert from 'node:assert/strict';
import { handleExternalMtprotoEndpointRequest } from '../src/http/external_mtproto_endpoint.js';

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
      resolveActiveSource: async () => ({
        id: 'source-1',
        provider_type: 'external_mtproto',
        secret: 'opaque-secret',
      }),
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
