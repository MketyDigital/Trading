import test from 'node:test';
import assert from 'node:assert/strict';

import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

const NOW = 1700000000000;

const SOURCES = {
  'telegram-container': {
    id: 'src-container',
    workspace_id: 'ws-1',
    source_type: 'telegram_mtproto',
    source_instance_id: 'container-a',
    source_family: 'telegram',
    provider_type: 'cloudflare_container_mtproto',
    external_identity: 'telegram-account-42',
    config: { chat_ids: ['-10012345'] },
    secret: 'container-secret',
  },
  'telegram-do': {
    id: 'src-do',
    workspace_id: 'ws-1',
    source_type: 'telegram_mtproto',
    source_instance_id: 'do-a',
    source_family: 'telegram',
    provider_type: 'cloudflare_do_mtproto',
    external_identity: 'telegram-account-42',
    config: { chat_ids: ['-10012345'] },
    secret: 'do-secret',
  },
};

function makeState() {
  const canonicalReservations = new Map();
  const reservations = [];
  let interpretations = 0;

  return {
    reservations,
    get interpretationCount() { return interpretations; },
    sourceStore: {
      getActiveSource: async (sourceId) => SOURCES[sourceId] || null,
    },
    eventStore: {
      reserve: async (row) => {
        reservations.push(row);
        const key = row.canonical_event_id || `${row.source_connection_id}:${row.external_event_id}`;
        if (canonicalReservations.has(key)) {
          return { ok: true, duplicate: true, eventId: canonicalReservations.get(key) };
        }
        const eventId = `evt-${canonicalReservations.size + 1}`;
        canonicalReservations.set(key, eventId);
        return { ok: true, duplicate: false, eventId };
      },
      updateInterpretation: async () => { interpretations += 1; },
    },
  };
}

function telegramPayload({ providerEventId, messageId }) {
  return {
    external_event_id: providerEventId,
    text: 'BUY XAUUSD 2526 SL 2518 TP 2530',
    metadata: {
      native_identity: {
        chat_id: '-10012345',
        message_id: String(messageId),
      },
    },
  };
}

async function signedRequest(sourceId, payload, secret = SOURCES[sourceId]?.secret) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    sourceId,
    timestamp: String(NOW),
    signature: await signSourcePayload(rawBody, String(NOW), secret || 'wrong-secret'),
    nowMs: NOW,
  };
}

test('same native Telegram message from different authenticated providers reserves once', async () => {
  const state = makeState();

  const first = await ingestTradingEvent(
    await signedRequest('telegram-container', telegramPayload({ providerEventId: 'container-update-900', messageId: 9876 })),
    state,
  );
  const second = await ingestTradingEvent(
    await signedRequest('telegram-do', telegramPayload({ providerEventId: 'do-update-144', messageId: 9876 })),
    state,
  );

  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.eventId, first.eventId);
  assert.equal(state.interpretationCount, 1);
  assert.equal(state.reservations.length, 2);
  assert.equal(state.reservations[0].external_event_id, 'container-update-900');
  assert.equal(state.reservations[1].external_event_id, 'do-update-144');
  assert.equal(state.reservations[0].canonical_event_id, 'telegram:telegram-account-42:-10012345:9876');
  assert.equal(state.reservations[1].canonical_event_id, state.reservations[0].canonical_event_id);
});

test('different Telegram messages remain distinct across providers', async () => {
  const state = makeState();

  const first = await ingestTradingEvent(
    await signedRequest('telegram-container', telegramPayload({ providerEventId: 'container-1', messageId: 9876 })),
    state,
  );
  const second = await ingestTradingEvent(
    await signedRequest('telegram-do', telegramPayload({ providerEventId: 'do-2', messageId: 9877 })),
    state,
  );

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.notEqual(first.eventId, second.eventId);
  assert.equal(state.interpretationCount, 2);
});

test('authentication happens before canonical dedupe so an invalid provider cannot suppress a valid event', async () => {
  const state = makeState();
  const payload = telegramPayload({ providerEventId: 'forged-event', messageId: 9876 });
  const forged = await signedRequest('telegram-do', payload, 'not-the-do-secret');

  const rejected = await ingestTradingEvent(forged, state);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 401);
  assert.equal(state.reservations.length, 0);
  assert.equal(state.interpretationCount, 0);

  const valid = await ingestTradingEvent(
    await signedRequest('telegram-container', telegramPayload({ providerEventId: 'valid-event', messageId: 9876 })),
    state,
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.duplicate, false);
  assert.equal(state.reservations.length, 1);
});
