import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

const NOW = 1700000000000;

function externalSource({ id, workspaceId, secret, allowedChats, active = true }) {
  return {
    id,
    workspace_id: workspaceId,
    source_type: 'telegram_mtproto',
    source_instance_id: `${id}-runtime`,
    source_family: 'telegram',
    provider_type: 'external_mtproto',
    external_identity: 'telegram-account-shared',
    config: {
      chat_acceptance_mode: 'allowlist',
      allowed_chat_ids: allowedChats,
    },
    secret,
    active,
  };
}

const SOURCE_A = externalSource({
  id: 'src-a', workspaceId: 'ws-a', secret: 'secret-a', allowedChats: ['-1001'],
});
const SOURCE_B = externalSource({
  id: 'src-b', workspaceId: 'ws-b', secret: 'secret-b', allowedChats: ['-1002', '-1001'],
});

function telegramPayload({ chatId = '-1001', messageId = '77', workspaceHint = 'caller-ws' } = {}) {
  return {
    external_event_id: `telegram:${chatId}:${messageId}`,
    workspace_hint: workspaceHint,
    text: 'BUY XAUUSD 2526 SL 2518 TP 2530',
    metadata: {
      native_identity: { chat_id: chatId, message_id: String(messageId) },
      account_scope: 'telegram-account-shared',
    },
  };
}

async function signed({ sourceId, secret, body }) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    sourceId,
    timestamp: String(NOW),
    signature: await signSourcePayload(rawBody, String(NOW), secret),
    nowMs: NOW,
  };
}

function makeState({ sourceA = SOURCE_A, sourceB = SOURCE_B } = {}) {
  const sources = new Map([[sourceA.id, sourceA], [sourceB.id, sourceB]]);
  const reservations = new Map();
  const reservationRows = [];
  let interpretations = 0;

  return {
    reservationRows,
    get interpretations() { return interpretations; },
    sourceStore: {
      async getActiveSource(sourceId) {
        const source = sources.get(sourceId);
        return source?.active ? source : null;
      },
    },
    eventStore: {
      async reserve(row) {
        reservationRows.push(row);
        const key = `${row.workspace_id}:${row.canonical_event_id || `${row.source_connection_id}:${row.external_event_id}`}`;
        if (reservations.has(key)) return { ok: true, duplicate: true, eventId: reservations.get(key) };
        const eventId = `evt-${row.workspace_id}-${reservations.size + 1}`;
        reservations.set(key, eventId);
        return { ok: true, duplicate: false, eventId };
      },
      async updateInterpretation() { interpretations += 1; },
    },
  };
}

async function deliver(state, source, body, secret = source.secret, sourceId = source.id) {
  return ingestTradingEvent(await signed({ sourceId, secret, body }), state);
}

test('same Telegram account chat and message remains isolated as one event per workspace', async () => {
  const state = makeState();
  const body = telegramPayload({ chatId: '-1001', messageId: '77' });
  const a = await deliver(state, SOURCE_A, body);
  const b = await deliver(state, SOURCE_B, body);

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, false);
  assert.notEqual(a.eventId, b.eventId);
  assert.equal(state.interpretations, 2);
  assert.deepEqual(state.reservationRows.map((row) => row.workspace_id), ['ws-a', 'ws-b']);
  assert.equal(state.reservationRows[0].canonical_event_id, state.reservationRows[1].canonical_event_id);
});

test('source A credential cannot authenticate as source B', async () => {
  const state = makeState();
  const forged = await deliver(state, SOURCE_B, telegramPayload({ chatId: '-1002' }), SOURCE_A.secret, SOURCE_B.id);

  assert.equal(forged.ok, false);
  assert.equal(forged.status, 401);
  assert.equal(state.reservationRows.length, 0);
  assert.equal(state.interpretations, 0);
});

test('caller workspace override cannot move an authenticated source event between tenants', async () => {
  const state = makeState();
  const result = await deliver(state, SOURCE_A, telegramPayload({ workspaceHint: 'ws-b' }));

  assert.equal(result.ok, true);
  assert.equal(state.reservationRows.length, 1);
  assert.equal(state.reservationRows[0].workspace_id, 'ws-a');
  assert.notEqual(state.reservationRows[0].workspace_id, 'ws-b');
});

test('source A unauthorized chat is rejected without changing source B authorization', async () => {
  const state = makeState();
  const a = await deliver(state, SOURCE_A, telegramPayload({ chatId: '-1002', messageId: '80' }));
  const b = await deliver(state, SOURCE_B, telegramPayload({ chatId: '-1002', messageId: '80' }));

  assert.equal(a.ok, false);
  assert.equal(a.status, 403);
  assert.equal(a.reason, 'MTPROTO_CHAT_NOT_AUTHORIZED');
  assert.equal(b.ok, true);
  assert.equal(b.duplicate, false);
  assert.equal(state.reservationRows.length, 1);
  assert.equal(state.reservationRows[0].workspace_id, 'ws-b');
  assert.equal(state.interpretations, 1);
});

test('disabling source A leaves source B operational', async () => {
  const state = makeState({ sourceA: { ...SOURCE_A, active: false } });
  const a = await deliver(state, SOURCE_A, telegramPayload({ chatId: '-1001', messageId: '81' }));
  const b = await deliver(state, SOURCE_B, telegramPayload({ chatId: '-1002', messageId: '81' }));

  assert.equal(a.ok, false);
  assert.equal(a.status, 401);
  assert.equal(a.reason, 'UNKNOWN_OR_INACTIVE_SOURCE');
  assert.equal(b.ok, true);
  assert.equal(b.duplicate, false);
  assert.equal(state.interpretations, 1);
});

test('one source policy config is never read as another source policy', async () => {
  const state = makeState();
  const onlyAChat = telegramPayload({ chatId: '-1001', messageId: '82' });
  const onlyBChat = telegramPayload({ chatId: '-1002', messageId: '83' });

  const aAllowed = await deliver(state, SOURCE_A, onlyAChat);
  const aBlocked = await deliver(state, SOURCE_A, onlyBChat);
  const bAllowed = await deliver(state, SOURCE_B, onlyBChat);

  assert.equal(aAllowed.ok, true);
  assert.equal(aBlocked.ok, false);
  assert.equal(aBlocked.reason, 'MTPROTO_CHAT_NOT_AUTHORIZED');
  assert.equal(bAllowed.ok, true);
  assert.deepEqual(state.reservationRows.map((row) => row.source_connection_id), ['src-a', 'src-b']);
});
