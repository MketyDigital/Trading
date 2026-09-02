import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeExternalMtprotoEvent } from '../src/sources/mtproto/external_policy.js';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

const NOW = 1700000000000;

function externalSource(overrides = {}) {
  return {
    id: 'src-ext',
    workspace_id: 'ws-1',
    source_type: 'telegram_mtproto',
    source_instance_id: 'external-a',
    source_family: 'telegram',
    provider_type: 'external_mtproto',
    external_identity: 'telegram-account-42',
    config: {
      chat_acceptance_mode: 'allowlist',
      allowed_chat_ids: ['-10012345'],
    },
    secret: 'ext-secret',
    ...overrides,
  };
}

function telegramInput({ chatId = '-10012345', messageId = '9876', accountScope, metadata = {}, ...overrides } = {}) {
  return {
    external_event_id: `telegram:${chatId}:${messageId}`,
    workspace_hint: 'caller-ws-must-not-win',
    text: 'BUY XAUUSD 2526 SL 2518 TP 2530',
    metadata: {
      native_identity: {
        chat_id: chatId,
        message_id: String(messageId),
      },
      ...(accountScope === undefined ? {} : { account_scope: accountScope }),
      ...metadata,
    },
    ...overrides,
  };
}

function assertReject(result, status, reason) {
  assert.equal(result.ok, false);
  assert.equal(result.status, status);
  assert.equal(result.reason, reason);
}

test('external MTProto allowlist authorizes only the exact configured chat', () => {
  assert.deepEqual(authorizeExternalMtprotoEvent({
    source: externalSource(),
    input: telegramInput(),
  }), { ok: true });

  assertReject(authorizeExternalMtprotoEvent({
    source: externalSource(),
    input: telegramInput({ chatId: '-10099999' }),
  }), 403, 'MTPROTO_CHAT_NOT_AUTHORIZED');
});

test('missing mode defaults to fail-closed allowlist and an empty allowlist accepts no chats', () => {
  const listed = externalSource({ config: { allowed_chat_ids: ['-10012345'] } });
  assert.deepEqual(authorizeExternalMtprotoEvent({ source: listed, input: telegramInput() }), { ok: true });

  const empty = externalSource({ config: {} });
  assertReject(authorizeExternalMtprotoEvent({ source: empty, input: telegramInput() }), 403, 'MTPROTO_CHAT_NOT_AUTHORIZED');
});

test('all_visible requires explicit server-side configuration and caller forwarding metadata cannot enable it', () => {
  assert.deepEqual(authorizeExternalMtprotoEvent({
    source: externalSource({ config: { chat_acceptance_mode: 'all_visible', allowed_chat_ids: [] } }),
    input: telegramInput({ chatId: '-10099999' }),
  }), { ok: true });

  assertReject(authorizeExternalMtprotoEvent({
    source: externalSource({ config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: [] } }),
    input: telegramInput({ chatId: '-10099999', metadata: { forward_all: true, chat_acceptance_mode: 'all_visible' } }),
  }), 403, 'MTPROTO_CHAT_NOT_AUTHORIZED');
});

test('malformed external MTProto source policy fails closed', () => {
  for (const source of [
    externalSource({ config: { chat_acceptance_mode: 'everything', allowed_chat_ids: [] } }),
    externalSource({ config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: '-10012345' } }),
    externalSource({ source_family: 'custom' }),
    externalSource({ external_identity: '' }),
  ]) {
    assertReject(authorizeExternalMtprotoEvent({ source, input: telegramInput() }), 400, 'MTPROTO_SOURCE_POLICY_INVALID');
  }
});

test('external MTProto requires native Telegram chat and message identity', () => {
  for (const input of [
    telegramInput({ chatId: '' }),
    telegramInput({ messageId: '' }),
    { text: 'BUY XAUUSD', metadata: {} },
  ]) {
    assertReject(authorizeExternalMtprotoEvent({ source: externalSource(), input }), 400, 'MTPROTO_NATIVE_IDENTITY_REQUIRED');
  }
});

test('caller-supplied account scope must match the server-authoritative source scope when present', () => {
  assert.deepEqual(authorizeExternalMtprotoEvent({
    source: externalSource(),
    input: telegramInput({ accountScope: 'telegram-account-42' }),
  }), { ok: true });

  assertReject(authorizeExternalMtprotoEvent({
    source: externalSource(),
    input: telegramInput({ accountScope: 'another-telegram-account' }),
  }), 403, 'MTPROTO_ACCOUNT_SCOPE_MISMATCH');
});

test('non-external providers are not subjected to external MTProto chat policy', () => {
  assert.deepEqual(authorizeExternalMtprotoEvent({
    source: externalSource({ provider_type: 'cloudflare_container_mtproto', config: {} }),
    input: telegramInput({ chatId: '-10099999' }),
  }), { ok: true });
});

async function signedInput(source, payload) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    sourceId: source.id,
    timestamp: String(NOW),
    signature: await signSourcePayload(rawBody, String(NOW), source.secret),
    nowMs: NOW,
  };
}

test('unauthorized external chat is rejected after HMAC auth but before reservation or AI', async () => {
  const source = externalSource();
  let reservations = 0;
  let aiLoads = 0;
  const state = {
    sourceStore: { getActiveSource: async () => source },
    eventStore: {
      reserve: async () => { reservations += 1; return { ok: true, duplicate: false, eventId: 'should-not-exist' }; },
      updateInterpretation: async () => {},
    },
    aiRouterFactory: async () => { aiLoads += 1; return {}; },
  };

  const result = await ingestTradingEvent(
    await signedInput(source, telegramInput({ chatId: '-10099999' })),
    state,
  );

  assertReject(result, 403, 'MTPROTO_CHAT_NOT_AUTHORIZED');
  assert.equal(reservations, 0);
  assert.equal(aiLoads, 0);
});

test('authenticated external source remains the workspace authority even if caller supplies another workspace hint', async () => {
  const source = externalSource();
  let reserved;
  const state = {
    sourceStore: { getActiveSource: async () => source },
    eventStore: {
      reserve: async (row) => { reserved = row; return { ok: true, duplicate: false, eventId: 'evt-1' }; },
      updateInterpretation: async () => {},
    },
  };

  const result = await ingestTradingEvent(await signedInput(source, telegramInput()), state);
  assert.equal(result.ok, true);
  assert.equal(reserved.workspace_id, 'ws-1');
  assert.notEqual(reserved.workspace_id, 'caller-ws-must-not-win');
  assert.equal(reserved.canonical_event_id, 'telegram:telegram-account-42:-10012345:9876');
});
