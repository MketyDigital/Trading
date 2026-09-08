import test from 'node:test';
import assert from 'node:assert/strict';

import { sendTelegramDestination } from '../src/destinations/telegram_destination.js';

test('Telegram destination adapter sends a sanitized sendMessage request and response', async () => {
  let seen;
  const result = await sendTelegramDestination({
    botToken: 'TEST_BOT_TOKEN',
    chatId: 'TEST_CHAT_ID',
    text: '<b>BUY XAUUSD</b>\nSL 2490\nTP1 2510',
    parseMode: 'HTML',
    fetchFn: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(seen.url, 'https://api.telegram.org/botTEST_BOT_TOKEN/sendMessage');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.chat_id, 'TEST_CHAT_ID');
  assert.equal(body.text, '<b>BUY XAUUSD</b>\nSL 2490\nTP1 2510');
  assert.equal(body.parse_mode, 'HTML');
  assert.deepEqual(result, { ok: true, messageId: 77, status: 200 });
  assert.equal(JSON.stringify(result).includes('TEST_BOT_TOKEN'), false);
});

test('Telegram destination adapter fails closed without returning Telegram response details', async () => {
  const result = await sendTelegramDestination({
    botToken: 'TEST_BOT_TOKEN',
    chatId: 'TEST_CHAT_ID',
    text: 'BUY XAUUSD',
    fetchFn: async () => new Response(JSON.stringify({
      ok: false,
      description: 'synthetic remote error detail',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  assert.deepEqual(result, { ok: false, status: 400, errorCode: 'TELEGRAM_SEND_REJECTED' });
  assert.equal(JSON.stringify(result).includes('synthetic remote error detail'), false);
});

test('Telegram destination adapter validates required fields before network use', async () => {
  let called = false;
  const result = await sendTelegramDestination({
    botToken: '',
    chatId: 'TEST_CHAT_ID',
    text: 'BUY XAUUSD',
    fetchFn: async () => {
      called = true;
      throw new Error('must not be called');
    },
  });

  assert.deepEqual(result, { ok: false, status: 0, errorCode: 'TELEGRAM_BOT_TOKEN_REQUIRED' });
  assert.equal(called, false);
});
