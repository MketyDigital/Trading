import test from 'node:test';
import assert from 'node:assert/strict';

import { handleTelegramBotWebhookRequest } from '../src/http/telegram_bot_webhook.js';
import { formatTelegramDestinationMessage } from '../src/destinations/formatting.js';
import { sendTelegramDestination } from '../src/destinations/telegram_destination.js';
import { productionTradeStateBindingPayload } from '../src/state/production_trade_state_binder.js';
import { TradeStateStore } from '../src/state/trade_state_store.js';

function botSource() {
  return {
    id: 'src-bot-1',
    workspace_id: 'ws-1',
    provider_type: 'telegram_bot_api',
    source_family: 'telegram',
    source_type: 'telegram_bot',
    source_instance_id: 'signals-bot',
    public_source_handle: 'public-handle-1',
    secret_ciphertext: 'encrypted-hook-secret',
    config: { chat_ids: ['-100123'] },
    is_active: true,
  };
}

function botRequest(update) {
  return new Request('https://trade.mkety.com/api/v1/webhooks/telegram-bot/public-handle-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'hook-secret',
    },
    body: JSON.stringify(update),
  });
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async list() { return new Map(this.values); }
}

test('Telegram Bot source preserves exact message text and native entities for verbatim destinations', async () => {
  const queued = [];
  const text = '  🔥 <BUY> XAUUSD\nSL 2490  ';
  const entities = [
    { type: 'bold', offset: 5, length: 5 },
    { type: 'custom_emoji', offset: 2, length: 2, custom_emoji_id: 'emoji-1' },
  ];
  const response = await handleTelegramBotWebhookRequest(botRequest({
    update_id: 701,
    channel_post: {
      message_id: 92,
      date: 1789236000,
      chat: { id: -100123, type: 'channel' },
      text,
      entities,
    },
  }), { TRADING_MASTER_KEY: 'master' }, {
    sourceStore: { getByPublicHandle: async () => botSource() },
    decryptSecret: async () => 'hook-secret',
    enqueueSourceEvent: async (_source, event) => { queued.push(event); },
  });

  assert.equal(response.status, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].text, text);
  assert.deepEqual(queued[0].metadata.telegram_entities, entities);
});

test('verbatim formatting mode never invokes canonical reconstruction and keeps raw text byte-for-byte', () => {
  const rawText = '🔥 **BUY** XAUUSD\n\nSL: 2490\nTP: 2510';
  const formatted = formatTelegramDestinationMessage({
    mode: 'verbatim',
    rawText,
    interpretation: null,
  }, {});

  assert.deepEqual(formatted, { ok: true, text: rawText, parseMode: 'plain' });
});

test('Telegram destination can send native entities without parse_mode', async () => {
  let body;
  const entities = [{ type: 'bold', offset: 0, length: 3 }];
  const result = await sendTelegramDestination({
    botToken: 'TEST_BOT_TOKEN',
    chatId: '-100123',
    text: 'BUY XAUUSD',
    entities,
    parseMode: 'plain',
    fetchFn: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(body.entities, entities);
  assert.equal('parse_mode' in body, false);
});

test('production binding does not turn missing management fill price into zero', () => {
  const payload = productionTradeStateBindingPayload({
    actionType: 'CLOSE_POSITION',
    status: 'OPEN',
    brokerPositionId: 'p-1',
    fillPrice: null,
    executedLots: 0.01,
  });

  assert.equal(payload.status, 'CLOSED');
  assert.equal('fillPrice' in payload, false);
  assert.equal(payload.executedLots, 0.01);
});

test('full close stamps closedAt and preserves the original open fill price', async () => {
  const store = new TradeStateStore(new MemoryStorage());
  await store.putGroup({
    id: 'g', status: 'OPEN', sourceEventIds: ['evt'],
    legs: [{
      legId: 'leg-1', targetIndex: 1, status: 'OPEN', lots: 0.01,
      brokerPositionId: 'p-1', fillPrice: 4307.12, openedAt: 10,
    }],
  });

  const closed = await store.bindLegExecution('g', 'leg-1', {
    actionType: 'CLOSE_POSITION',
    status: 'OPEN',
    executedLots: 0.01,
    brokerPositionId: 'p-1',
    brokerOrderId: 'close-order-1',
    fillPrice: null,
  }, 2000);

  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.legs[0].status, 'CLOSED');
  assert.equal(closed.legs[0].lots, 0);
  assert.equal(closed.legs[0].fillPrice, 4307.12);
  assert.equal(closed.legs[0].closedAt, 2000);
});
