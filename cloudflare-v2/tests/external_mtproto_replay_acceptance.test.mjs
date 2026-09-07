import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

const NOW = 1700000000000;

const SOURCES = {
  container: {
    id: 'src-container',
    workspace_id: 'ws-1',
    source_type: 'telegram_mtproto',
    source_instance_id: 'container-a',
    source_family: 'telegram',
    provider_type: 'cloudflare_container_mtproto',
    external_identity: 'telegram-account-42',
    config: {},
    secret: 'container-secret',
  },
  external: {
    id: 'src-external',
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
    secret: 'external-secret',
  },
};

function payload(messageId = '9876') {
  const chatId = '-10012345';
  return {
    external_event_id: `telegram:${chatId}:${messageId}`,
    text: 'BUY XAUUSD 2526 SL 2518 TP 2530',
    metadata: {
      native_identity: { chat_id: chatId, message_id: String(messageId) },
      account_scope: 'telegram-account-42',
    },
  };
}

async function signed(source, body, secret = source.secret) {
  const rawBody = JSON.stringify(body);
  return {
    rawBody,
    sourceId: source.id,
    timestamp: String(NOW),
    signature: await signSourcePayload(rawBody, String(NOW), secret),
    nowMs: NOW,
  };
}

function makeState() {
  const reservations = new Map();
  let interpretations = 0;
  let orchestration = 0;
  let destinations = 0;
  return {
    get interpretations() { return interpretations; },
    get orchestration() { return orchestration; },
    get destinations() { return destinations; },
    sourceStore: {
      async getActiveSource(sourceId) {
        return Object.values(SOURCES).find((source) => source.id === sourceId) || null;
      },
    },
    eventStore: {
      async reserve(row) {
        const key = `${row.workspace_id}:${row.canonical_event_id || `${row.source_connection_id}:${row.external_event_id}`}`;
        if (reservations.has(key)) return { ok: true, duplicate: true, eventId: reservations.get(key) };
        const eventId = `evt-${reservations.size + 1}`;
        reservations.set(key, eventId);
        return { ok: true, duplicate: false, eventId };
      },
      async updateInterpretation() { interpretations += 1; },
    },
    async ingestAndContinue(request) {
      const result = await ingestTradingEvent(request, this);
      if (result.ok && !result.duplicate) {
        orchestration += 1;
        destinations += 1;
      }
      return result;
    },
  };
}

test('Container first then independently authenticated external replay becomes persistent duplicate exactly once', async () => {
  const state = makeState();
  const first = await state.ingestAndContinue(await signed(SOURCES.container, payload('9876')));
  const replay = await state.ingestAndContinue(await signed(SOURCES.external, payload('9876')));

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.eventId, first.eventId);
  assert.equal(state.interpretations, 1);
  assert.equal(state.orchestration, 1);
  assert.equal(state.destinations, 1);
});

test('external first then Container replay converges to the same canonical event exactly once', async () => {
  const state = makeState();
  const first = await state.ingestAndContinue(await signed(SOURCES.external, payload('9876')));
  const replay = await state.ingestAndContinue(await signed(SOURCES.container, payload('9876')));

  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.eventId, first.eventId);
  assert.equal(state.interpretations, 1);
  assert.equal(state.orchestration, 1);
  assert.equal(state.destinations, 1);
});

test('new Telegram message id after cross-provider replay proceeds normally once', async () => {
  const state = makeState();
  await state.ingestAndContinue(await signed(SOURCES.container, payload('9876')));
  await state.ingestAndContinue(await signed(SOURCES.external, payload('9876')));
  const next = await state.ingestAndContinue(await signed(SOURCES.external, payload('9877')));

  assert.equal(next.ok, true);
  assert.equal(next.duplicate, false);
  assert.equal(state.interpretations, 2);
  assert.equal(state.orchestration, 2);
  assert.equal(state.destinations, 2);
});

test('invalid external authentication cannot reserve or suppress the canonical identity', async () => {
  const state = makeState();
  const forged = await state.ingestAndContinue(await signed(SOURCES.external, payload('9876'), 'wrong-secret'));
  assert.equal(forged.ok, false);
  assert.equal(forged.status, 401);
  assert.equal(state.interpretations, 0);
  assert.equal(state.orchestration, 0);

  const legitimate = await state.ingestAndContinue(await signed(SOURCES.container, payload('9876')));
  assert.equal(legitimate.ok, true);
  assert.equal(legitimate.duplicate, false);
  assert.equal(state.interpretations, 1);
  assert.equal(state.orchestration, 1);
});

test('direct external persistent duplicate is terminal success compatible with sink semantics', async () => {
  const state = makeState();
  const first = await state.ingestAndContinue(await signed(SOURCES.external, payload('9876')));
  const duplicate = await state.ingestAndContinue(await signed(SOURCES.external, payload('9876')));

  assert.deepEqual(
    { ok: duplicate.ok, duplicate: duplicate.duplicate, eventId: duplicate.eventId },
    { ok: true, duplicate: true, eventId: first.eventId },
  );
  assert.equal(state.orchestration, 1);
  assert.equal(state.destinations, 1);
});
