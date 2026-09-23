import test from 'node:test';
import assert from 'node:assert/strict';

import { runV1DestinationDeliveryAcceptanceStage } from '../src/destinations/v1_destination_delivery_acceptance.js';

const raw = '  BUY XAUUSD NOW\nTP 2500  ';

function destinationStore(destination) {
  return {
    async listRoutedDestinations() { return [destination]; },
    async recordDestinationOutcome() {},
  };
}

test('destination Forward as-is override wins over an attached structured template', async () => {
  let formattingMode = null;
  let sentText = null;
  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1',
    sourceId: 'source-1',
    event: { text: raw, metadata: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' } } },
    env: { TRADING_MASTER_KEY: 'unused-in-test' },
  }, {
    destinationStore: destinationStore({
      id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-1001', is_active: true,
      credential_ciphertext: 'cipher',
      settings: { formattingMode: 'none' },
      template: { formatting_mode: 'template', parse_mode: 'HTML', header: 'SHOULD NOT APPEAR' },
    }),
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'token' } }),
    formatTelegram: ({ mode, rawText }) => {
      formattingMode = mode;
      return { ok: true, text: mode === 'none' ? rawText : `FORMATTED:${rawText}`, parseMode: mode === 'none' ? 'plain' : 'HTML' };
    },
    sendTelegram: async ({ text }) => { sentText = text; return { ok: true, status: 200, messageId: 7 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(formattingMode, 'none');
  assert.equal(sentText, raw);
});

test('inherit preserves an attached saved template mode', async () => {
  let formattingMode = null;
  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1', sourceId: 'source-1', event: { text: raw }, interpretation: { status: 'READY', intent: {} }, env: {},
  }, {
    destinationStore: destinationStore({
      id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-1001', is_active: true,
      credential_ciphertext: 'cipher', settings: { formattingMode: 'inherit' }, template: { formatting_mode: 'clean', parse_mode: 'plain' },
    }),
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'token' } }),
    formatTelegram: ({ mode, rawText }) => { formattingMode = mode; return { ok: true, text: rawText, parseMode: 'plain' }; },
    sendTelegram: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(result.status, 'DELIVERED');
  assert.equal(formattingMode, 'clean');
});


test('clean_ai_fallback sends an edited source post standalone when the destination has no mapped parent', async () => {
  let sends = 0;
  let edits = 0;
  const supabase = {
    from(table) {
      if (table === 'trading_events') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const result = await runV1DestinationDeliveryAcceptanceStage({
    workspaceId: 'ws-1',
    sourceId: 'source-1',
    event: {
      external_event_id: 'telegram:-1001:55',
      text: 'QAS VIP SIGNAL\nAnalysis updated',
      metadata: {
        telegram_update_kind: 'edited_channel_post',
        native_identity: { chat_id: '-1001' },
      },
    },
    interpretation: { status: 'NEEDS_REVIEW' },
    env: {},
  }, {
    supabase,
    destinationStore: destinationStore({
      id: 'dest-1', workspace_id: 'ws-1', destination_type: 'telegram', destination_ref: '-1009', is_active: true,
      credential_ciphertext: 'cipher',
      settings: { formattingMode: 'clean_ai_fallback' },
      template: { formatting_mode: 'clean_ai_fallback', cleanup_rules: { removeLinePatterns: ['^QAS VIP SIGNAL$'] } },
    }),
    decryptCredentials: async () => JSON.stringify({ version: 1, kind: 'destination', data: { botToken: 'token' } }),
    aiFormatterFactory: async () => null,
    sendTelegram: async () => { sends += 1; return { ok: true, status: 200, messageId: 99 }; },
    editTelegram: async () => { edits += 1; return { ok: true, status: 200, messageId: 98 }; },
  });

  assert.equal(result.status, 'DELIVERED');
  assert.equal(sends, 1);
  assert.equal(edits, 0);
});
