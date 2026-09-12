import test from 'node:test';
import assert from 'node:assert/strict';

import { PROVIDER_TYPES, getProviderDefinition } from '../src/sources/provider_registry.js';
import { validateConnectionCredentials } from '../src/security/connection_credentials.js';
import { canUseSourceProvider } from '../src/security/trading_entitlements.js';
import { handleTelegramBotWebhookRequest } from '../src/http/telegram_bot_webhook.js';

function source(overrides = {}) {
  return {
    id: 'src-bot-1',
    workspace_id: 'ws-real',
    provider_type: 'telegram_bot_api',
    source_family: 'telegram',
    source_type: 'telegram_bot',
    source_instance_id: 'signals-bot',
    external_identity: 'bot-123',
    public_source_handle: 'public-handle-1',
    secret_ciphertext: 'encrypted-hook-secret',
    config: { chat_ids: ['-100123'] },
    is_active: true,
    ...overrides,
  };
}

function request(update, secret = 'hook-secret') {
  return new Request('https://trade.mkety.com/api/v1/webhooks/telegram-bot/public-handle-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': secret,
    },
    body: JSON.stringify(update),
  });
}

test('provider registry exposes Telegram Bot API as native Telegram source', () => {
  assert.equal(PROVIDER_TYPES.TELEGRAM_BOT_API, 'telegram_bot_api');
  const definition = getProviderDefinition('telegram_bot_api');
  assert.equal(definition.sourceFamily, 'telegram');
  assert.equal(definition.runtimeKind, 'webhook');
  assert.equal(definition.nativeIdentity, true);
});

test('Telegram bot token is a supported encrypted connection credential kind', () => {
  assert.deepEqual(validateConnectionCredentials('telegram_bot', { botToken: '123:abc' }), { botToken: '123:abc' });
  assert.throws(() => validateConnectionCredentials('telegram_bot', { botToken: '' }));
  assert.throws(() => validateConnectionCredentials('telegram_bot', { botToken: '123:abc', workspaceId: 'spoof' }));
});

test('access-code source entitlements accept family or exact provider and reject unrelated source families', () => {
  const byFamily = { workspace: { metadata: { accessCodeProvisioned: true, entitlements: { sourceTypes: ['telegram'] } } } };
  const byProvider = { workspace: { metadata: { accessCodeProvisioned: true, entitlements: { sourceTypes: ['telegram_bot_api'] } } } };
  const denied = { workspace: { metadata: { accessCodeProvisioned: true, entitlements: { sourceTypes: ['tradingview'] } } } };
  assert.equal(canUseSourceProvider(byFamily, { sourceFamily: 'telegram', providerType: 'telegram_bot_api' }), true);
  assert.equal(canUseSourceProvider(byProvider, { sourceFamily: 'telegram', providerType: 'telegram_bot_api' }), true);
  assert.equal(canUseSourceProvider(denied, { sourceFamily: 'telegram', providerType: 'telegram_bot_api' }), false);
});

test('Bot webhook authenticates Telegram secret, enforces DB chat scope and enqueues compact canonical native event', async () => {
  const queued = [];
  const sourceStore = { getByPublicHandle: async (handle) => handle === 'public-handle-1' ? source() : null };
  const deps = {
    sourceStore,
    decryptSecret: async () => 'hook-secret',
    enqueueSourceEvent: async (trustedSource, event) => { queued.push({ trustedSource, event }); return { queued: true }; },
  };

  const response = await handleTelegramBotWebhookRequest(request({
    update_id: 700,
    message: {
      message_id: 91,
      date: 1789236000,
      chat: { id: -100123, type: 'channel' },
      from: { id: 44 },
      text: 'BUY XAUUSD NOW SL 2490 TP 2510',
      reply_to_message: { message_id: 90 },
      workspace_id: 'attacker-workspace',
      account_id: 'attacker-account',
    },
  }), { TRADING_MASTER_KEY: 'master' }, deps);

  assert.equal(response.status, 200);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].trustedSource.workspace_id, 'ws-real');
  assert.equal(queued[0].event.external_event_id, '-100123:91');
  assert.equal(queued[0].event.source_external_id, '-100123');
  assert.equal(queued[0].event.text, 'BUY XAUUSD NOW SL 2490 TP 2510');
  assert.equal(queued[0].event.metadata.native_identity.chat_id, '-100123');
  assert.equal(queued[0].event.metadata.native_identity.message_id, '91');
  assert.equal(queued[0].event.thread.reply_to_message_id, '90');
  assert.equal('workspace_id' in queued[0].event, false);
  assert.equal('account_id' in queued[0].event, false);
});

test('Bot webhook rejects bad secret and unauthorized chat before queue/trading work', async () => {
  let queued = 0;
  const deps = {
    sourceStore: { getByPublicHandle: async () => source() },
    decryptSecret: async () => 'hook-secret',
    enqueueSourceEvent: async () => { queued += 1; },
  };

  const badSecret = await handleTelegramBotWebhookRequest(request({ message: { message_id: 1, chat: { id: -100123 }, text: 'BUY GOLD' } }, 'wrong'), { TRADING_MASTER_KEY: 'master' }, deps);
  assert.equal(badSecret.status, 401);

  const badChat = await handleTelegramBotWebhookRequest(request({ message: { message_id: 2, chat: { id: -999 }, text: 'BUY GOLD' } }), { TRADING_MASTER_KEY: 'master' }, deps);
  assert.equal(badChat.status, 403);
  assert.equal(queued, 0);
});

test('Bot webhook accepts channel posts, captions and edited/follow-up messages with native identity intact', async () => {
  const events = [];
  const deps = {
    sourceStore: { getByPublicHandle: async () => source() },
    decryptSecret: async () => 'hook-secret',
    enqueueSourceEvent: async (_source, event) => { events.push(event); return { queued: true }; },
  };

  for (const update of [
    { channel_post: { message_id: 10, chat: { id: -100123 }, caption: 'SELL XAUUSD', date: 1789236000 } },
    { edited_message: { message_id: 11, chat: { id: -100123 }, text: 'MOVE SL TO BE', date: 1789236001, reply_to_message: { message_id: 10 } } },
  ]) {
    const response = await handleTelegramBotWebhookRequest(request(update), { TRADING_MASTER_KEY: 'master' }, deps);
    assert.equal(response.status, 200);
  }

  assert.equal(events[0].text, 'SELL XAUUSD');
  assert.equal(events[1].text, 'MOVE SL TO BE');
  assert.equal(events[1].thread.reply_to_message_id, '10');
  assert.equal(events[1].metadata.telegram_update_kind, 'edited_message');
});