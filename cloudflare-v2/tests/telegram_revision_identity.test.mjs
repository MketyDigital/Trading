import test from 'node:test';
import assert from 'node:assert/strict';

import { handleTelegramBotWebhookRequest } from '../src/http/telegram_bot_webhook.js';
import { buildSourceRevisionKey } from '../src/events/source_revision.js';

function source() {
  return {
    id: 'src-bot-1',
    workspace_id: 'ws-1',
    provider_type: 'telegram_bot_api',
    source_family: 'telegram',
    source_type: 'telegram_bot',
    source_instance_id: 'signals-bot',
    public_source_handle: 'public-handle-1',
    secret_ciphertext: 'ciphertext',
    config: { chat_ids: ['-100123'] },
    is_active: true,
  };
}

function request(update) {
  return new Request('https://trade.mkety.com/api/v1/webhooks/telegram-bot/public-handle-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'hook-secret',
    },
    body: JSON.stringify(update),
  });
}

test('Telegram Bot edit preserves stable native identity and declares exact edit lineage', async () => {
  const queued = [];
  const response = await handleTelegramBotWebhookRequest(request({
    update_id: 901,
    edited_channel_post: {
      message_id: 317,
      date: 1789236000,
      edit_date: 1789236060,
      chat: { id: -100123, type: 'channel' },
      text: 'xauusd sell\nentry 4273.25-4279.76\nsl 4380',
    },
  }), { TRADING_MASTER_KEY: 'master' }, {
    sourceStore: { getByPublicHandle: async () => source() },
    decryptSecret: async () => 'hook-secret',
    enqueueSourceEvent: async (_trusted, event) => { queued.push(event); },
  });

  assert.equal(response.status, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].external_event_id, '-100123:317');
  assert.deepEqual(queued[0].metadata.native_identity, { chat_id: '-100123', message_id: '317' });
  assert.equal(queued[0].metadata.telegram_update_kind, 'edited_channel_post');
  assert.equal(queued[0].thread.edited_event_id, '317');
});

test('revision key is stable for exact replay and changes when edited content changes', async () => {
  const base = {
    source: { type: 'telegram_bot', external_id: '-100123' },
    external_event_id: '-100123:317',
    occurred_at: '2026-09-16T20:21:00.000Z',
    text: 'SELL XAUUSD ENTRY 4275 SL 4380',
    structured_payload: {},
    thread: { edited_event_id: 'telegram:-100123:317' },
    metadata: {
      telegram_update_kind: 'edited_channel_post',
      telegram_update_id: 901,
      native_identity: { chat_id: '-100123', message_id: '317' },
    },
  };

  const one = await buildSourceRevisionKey(base);
  const replay = await buildSourceRevisionKey(structuredClone(base));
  const changed = await buildSourceRevisionKey({ ...base, text: 'SELL XAUUSD ENTRY 4275 SL 4390' });

  assert.match(one, /^sha256:[a-f0-9]{64}$/);
  assert.equal(replay, one);
  assert.notEqual(changed, one);
});

test('non-edit source event does not acquire a revision key', async () => {
  const key = await buildSourceRevisionKey({
    source: { type: 'telegram_bot' },
    external_event_id: '-100123:318',
    text: 'BUY XAUUSD',
    thread: {},
    metadata: { native_identity: { chat_id: '-100123', message_id: '318' } },
  });
  assert.equal(key, null);
});
