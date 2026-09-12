import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

async function signedEvent(chatId) {
  const now = 1789236000000;
  const rawBody = JSON.stringify({
    version: '1.0',
    source: { type: 'telegram_bot', instance_id: 'signals-bot', external_id: chatId },
    external_event_id: `${chatId}:91`,
    occurred_at: new Date(now).toISOString(),
    received_at: new Date(now).toISOString(),
    text: 'BUY XAUUSD NOW SL 2490 TP 2510',
    structured_payload: {},
    thread: {},
    metadata: { native_identity: { chat_id: chatId, message_id: '91' } },
  });
  return {
    rawBody,
    sourceId: 'src-bot-1',
    timestamp: String(now),
    signature: await signSourcePayload(rawBody, String(now), 'source-secret'),
    nowMs: now,
  };
}

function stores() {
  let reservations = 0;
  return {
    reservations: () => reservations,
    sourceStore: {
      getActiveSource: async () => ({
        id: 'src-bot-1',
        workspace_id: 'ws-1',
        source_type: 'telegram_bot',
        source_instance_id: 'signals-bot',
        source_family: 'telegram',
        provider_type: 'telegram_bot_api',
        external_identity: 'bot-123',
        config: { chat_ids: ['-100123'] },
        secret: 'source-secret',
      }),
    },
    eventStore: {
      reserve: async () => { reservations += 1; return { ok: true, duplicate: false, eventId: 'evt-1' }; },
      updateInterpretation: async () => {},
    },
  };
}

test('canonical ingest rejects forged/unauthorized Telegram Bot chat even if queue/webhook layer was bypassed', async () => {
  const state = stores();
  const result = await ingestTradingEvent(await signedEvent('-999'), state);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'TELEGRAM_BOT_CHAT_NOT_AUTHORIZED');
  assert.equal(state.reservations(), 0);
});

test('canonical ingest accepts authorized Telegram Bot native identity and proceeds normally', async () => {
  const state = stores();
  const result = await ingestTradingEvent(await signedEvent('-100123'), state);
  assert.equal(result.ok, true);
  assert.equal(result.event.workspace_hint, 'ws-1');
  assert.equal(state.reservations(), 1);
});
