import test from 'node:test';
import assert from 'node:assert/strict';

import { sendTelegramDestination } from '../src/destinations/telegram_destination.js';
import { runV1DestinationDeliveryAcceptanceStage, telegramThreading } from '../src/destinations/v1_destination_delivery_acceptance.js';

test('Telegram adapter preserves sanitized Bot API rejection details', async () => {
  const result = await sendTelegramDestination({
    botToken: '123456:secret',
    chatId: '-1001',
    text: 'BUY XAUUSD',
    fetchFn: async () => ({
      ok: false,
      status: 403,
      async json() {
        return { ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the channel chat', parameters: { retry_after: 7 } };
      },
    }),
  });
  assert.deepEqual(result, {
    ok: false,
    status: 403,
    errorCode: 'TELEGRAM_SEND_REJECTED',
    providerCode: 403,
    providerDescription: 'Forbidden: bot is not a member of the channel chat',
    retryAfter: 7,
  });
  assert.equal(JSON.stringify(result).includes('123456:secret'), false);
});

test('Telegram delivery failure is journaled against the trading event', async () => {
  let journalRow = null;
  const supabase = {
    from(table) {
      if (table === 'trading_events') {
        return {
          select() { return this; }, eq() { return this; },
          async maybeSingle() { return { data: { id: 'event-uuid' }, error: null }; },
        };
      }
      if (table === 'destination_deliveries') {
        return {
          async upsert(row) { journalRow = row; return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  await telegramThreading.recordTelegramDeliveryOutcome(
    supabase,
    'ws-1',
    { id: 'dest-1', destination_ref: '-1001' },
    'telegram:-1001:22',
    { ok: false, status: 403, errorCode: 'TELEGRAM_SEND_REJECTED', providerCode: 403, providerDescription: 'Forbidden: bot is not a member' },
  );

  assert.equal(journalRow.workspace_id, 'ws-1');
  assert.equal(journalRow.trading_event_id, 'event-uuid');
  assert.equal(journalRow.destination_type, 'telegram');
  assert.equal(journalRow.status, 'FAILED');
  assert.equal(journalRow.error_code, 'TELEGRAM_SEND_REJECTED');
  assert.equal(journalRow.failure_class, 'TERMINAL');
  assert.equal(journalRow.response_payload.providerCode, 403);
  assert.equal(journalRow.response_payload.providerDescription, 'Forbidden: bot is not a member');
});

test('Forward as-is sends original text even when trading interpretation needs review', async () => {
  const raw = 'BUY XAUUSD (CMP)\n\n~~~\nStarpips Forex';
  let sent = null;
  let aiCalled = false;
  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1',
    sourceId: 'source-1',
    event: { external_event_id: 'telegram:-1001:22', text: raw, metadata: { native_identity: { chat_id: '-1001', message_id: '22' } } },
    interpretation: { status: 'NEEDS_REVIEW', reason: 'AI unavailable' },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    destinationStore: {
      async listRoutedDestinations() {
        return [{
          id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-1002', is_active: true,
          credential_ciphertext: 'cipher', template: { formatting_mode: 'none', parse_mode: 'plain' }, route_filters: {},
        }];
      },
      async recordDestinationOutcome() {},
    },
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'token' } }),
    sendTelegram: async (input) => { sent = input; return { ok: true, status: 200, messageId: 99 }; },
    aiFormatterFactory: async () => { aiCalled = true; throw new Error('AI must not be used'); },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(sent.text, raw);
  assert.equal(sent.parseMode, 'plain');
  assert.equal(aiCalled, false);
});
