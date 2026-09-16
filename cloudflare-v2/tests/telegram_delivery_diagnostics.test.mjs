import test from 'node:test';
import assert from 'node:assert/strict';

import { sendTelegramDestination } from '../src/destinations/telegram_destination.js';
import { telegramThreading } from '../src/destinations/v1_destination_delivery_acceptance.js';

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
