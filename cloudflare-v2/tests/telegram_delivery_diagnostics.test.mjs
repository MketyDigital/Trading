import test from 'node:test';
import assert from 'node:assert/strict';

import { sendTelegramDestination, editTelegramDestination } from '../src/destinations/telegram_destination.js';
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

test('Telegram edit adapter edits the existing destination message and preserves native entities', async () => {
  let request = null;
  const result = await editTelegramDestination({
    botToken: '123456:secret',
    chatId: '-1002',
    messageId: 99,
    text: 'SELL XAUUSD\nSL 4380',
    parseMode: 'plain',
    entities: [{ type: 'bold', offset: 0, length: 4 }],
    fetchFn: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, result: { message_id: 99 } }; },
      };
    },
  });

  assert.match(request.url, /\/editMessageText$/);
  assert.deepEqual(request.body, {
    chat_id: '-1002',
    message_id: 99,
    text: 'SELL XAUUSD\nSL 4380',
    disable_web_page_preview: true,
    entities: [{ type: 'bold', offset: 0, length: 4 }],
  });
  assert.deepEqual(result, { ok: true, messageId: 99, status: 200, edited: true });
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

function lineageSupabase({ mappedMessageId = 99 } = {}) {
  let journalRow = null;
  return {
    get journalRow() { return journalRow; },
    from(table) {
      if (table === 'trading_events') {
        return {
          select() { return this; }, eq() { return this; },
          async maybeSingle() { return { data: { id: 'event-uuid' }, error: null }; },
        };
      }
      if (table === 'destination_deliveries') {
        return {
          select() { return this; }, eq() { return this; }, order() { return this; },
          async limit() {
            return { data: mappedMessageId == null ? [] : [{ response_payload: { messageId: mappedMessageId } }], error: null };
          },
          async upsert(row) { journalRow = row; return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('edited Telegram source updates the mapped destination message instead of sending a duplicate', async () => {
  const supabase = lineageSupabase({ mappedMessageId: 99 });
  let sent = 0;
  let edited = null;
  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1',
    sourceId: 'source-1',
    event: {
      external_event_id: 'telegram:-1001:22',
      text: 'SELL XAUUSD\nSL 4380',
      thread: { edited_event_id: 'telegram:-1001:22' },
      metadata: {
        telegram_update_kind: 'edited_message',
        telegram_entities: [{ type: 'bold', offset: 0, length: 4 }],
        native_identity: { chat_id: '-1001', message_id: '22' },
      },
    },
    interpretation: { status: 'READY', source: 'deterministic', intent: { side: 'SELL', symbol: { canonical: 'XAUUSD' } } },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    supabase,
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
    sendTelegram: async () => { sent += 1; return { ok: true, status: 200, messageId: 100 }; },
    editTelegram: async (input) => { edited = input; return { ok: true, status: 200, messageId: 99, edited: true }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(sent, 0);
  assert.equal(edited.messageId, 99);
  assert.equal(edited.text, 'SELL XAUUSD\nSL 4380');
  assert.deepEqual(edited.entities, [{ type: 'bold', offset: 0, length: 4 }]);
  assert.equal(supabase.journalRow.response_payload.messageId, 99);
});

test('unresolved Telegram edit mapping fails isolated and never falls back to a standalone send', async () => {
  const supabase = lineageSupabase({ mappedMessageId: null });
  let sent = 0;
  let edited = 0;
  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1',
    sourceId: 'source-1',
    event: {
      external_event_id: 'telegram:-1001:22',
      text: 'SELL XAUUSD\nSL 4380',
      thread: { edited_event_id: 'telegram:-1001:22' },
      metadata: { telegram_update_kind: 'edited_message', native_identity: { chat_id: '-1001', message_id: '22' } },
    },
    interpretation: { status: 'READY', source: 'deterministic', intent: { side: 'SELL', symbol: { canonical: 'XAUUSD' } } },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    supabase,
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
    sendTelegram: async () => { sent += 1; return { ok: true, status: 200, messageId: 100 }; },
    editTelegram: async () => { edited += 1; return { ok: true, status: 200, messageId: 99, edited: true }; },
  });

  assert.equal(sent, 0);
  assert.equal(edited, 0);
  assert.equal(result.status, 'FAILED');
  assert.equal(supabase.journalRow.error_code, 'TELEGRAM_EDIT_PARENT_UNRESOLVED');
});

test('Telegram Bot reply resolves parent delivery across equivalent telegram-prefixed and native event identities', async () => {
  let sent = null;
  let currentExternalLookup = null;
  const supabase = {
    from(table) {
      if (table === 'trading_events') {
        return {
          select() { return this; },
          eq(column, value) {
            if (column === 'external_event_id') currentExternalLookup = String(value);
            return this;
          },
          async maybeSingle() {
            return {
              data: currentExternalLookup === '-1001:21' ? { id: 'parent-event-uuid' } : null,
              error: null,
            };
          },
        };
      }
      if (table === 'destination_deliveries') {
        return {
          select() { return this; }, eq() { return this; }, order() { return this; },
          async limit() { return { data: [{ response_payload: { messageId: 77 } }], error: null }; },
          async upsert() { return { error: null }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1',
    sourceId: 'bot-source-1',
    event: {
      external_event_id: '-1001:22',
      text: 'Move Stop Loss to Break Even.',
      thread: { reply_to_event_id: 'telegram:-1001:21' },
      metadata: { native_identity: { chat_id: '-1001', message_id: '22' } },
    },
    interpretation: { status: 'MANAGEMENT' },
    env: { TRADING_MASTER_KEY: 'master' },
  }, {
    supabase,
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
    sendTelegram: async (input) => { sent = input; return { ok: true, status: 200, messageId: 88 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(sent.replyToMessageId, 77);
});
