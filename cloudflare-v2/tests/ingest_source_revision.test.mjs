import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

const source = {
  id: 'src-telegram',
  secret: 'secret',
  workspace_id: 'ws-1',
  source_type: 'telegram_bot',
  source_instance_id: 'bot-1',
  source_family: 'telegram',
  provider_type: 'telegram_bot_api',
  external_identity: 'bot-account-1',
  config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-100123'] },
};

async function signedInput(body) {
  const rawBody = JSON.stringify(body);
  const timestamp = '1700000000000';
  return {
    rawBody,
    sourceId: source.id,
    timestamp,
    signature: await signSourcePayload(rawBody, timestamp, source.secret),
    nowMs: Number(timestamp),
  };
}

function editBody(text) {
  return {
    version: '1.0',
    source: { type: 'telegram_bot', instance_id: 'ignored', external_id: '-100123' },
    external_event_id: '-100123:317',
    occurred_at: '2026-09-16T20:21:00.000Z',
    received_at: '2026-09-16T20:22:00.000Z',
    text,
    structured_payload: {},
    thread: { edited_event_id: '317' },
    metadata: {
      telegram_update_kind: 'edited_channel_post',
      native_identity: { chat_id: '-100123', message_id: '317' },
    },
  };
}

const persistedOriginal = {
  version: '1.0',
  source_type: 'telegram_bot',
  source_external_id: '-100123',
  external_event_id: '-100123:317',
  occurred_at: '2026-09-16T20:20:00.000Z',
  received_at: '2026-09-16T20:20:01.000Z',
  text: 'SELL XAUUSD ENTRY 4275 SL 4380 TP 4250',
  structured_payload: {},
  thread: {},
  metadata: { native_identity: { chat_id: '-100123', message_id: '317' } },
};

test('changed Telegram edit is reserved as a new revision and interpreted from incoming edited content', async () => {
  const incoming = editBody('SELL XAUUSD ENTRY 4275 SL 4390 TP 4250');
  const revisionRows = [];
  let persistedRevisionInterpretation = null;

  const result = await ingestTradingEvent(await signedInput(incoming), {
    sourceStore: { getActiveSource: async () => source },
    eventStore: {
      reserve: async () => ({
        ok: true,
        duplicate: true,
        eventId: 'evt-parent',
        event: persistedOriginal,
        interpretation: { status: 'READY', intent: { side: 'SELL', symbol: { canonical: 'XAUUSD' } } },
      }),
      reserveRevision: async (row) => {
        revisionRows.push(structuredClone(row));
        return { ok: true, duplicate: false, revisionId: 'rev-1' };
      },
      updateRevisionInterpretation: async (revisionId, interpretation) => {
        assert.equal(revisionId, 'rev-1');
        persistedRevisionInterpretation = structuredClone(interpretation);
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.revision, true);
  assert.equal(result.eventId, 'evt-parent');
  assert.equal(result.revisionId, 'rev-1');
  assert.equal(result.event.text, incoming.text);
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(result.interpretation.intent.stopLoss, 4390);
  assert.equal(revisionRows.length, 1);
  assert.equal(revisionRows[0].trading_event_id, 'evt-parent');
  assert.match(revisionRows[0].revision_key, /^sha256:[a-f0-9]{64}$/);
  assert.equal(revisionRows[0].raw_text, incoming.text);
  assert.equal(persistedRevisionInterpretation?.status, 'READY');
});

test('exact replay of the same Telegram edit revision stays duplicate and does not reinterpret incoming content', async () => {
  const incoming = editBody('SELL XAUUSD ENTRY 4275 SL 4390 TP 4250');
  let updateCalls = 0;
  const persistedRevisionEvent = {
    ...persistedOriginal,
    text: incoming.text,
    thread: { edited_event_id: '317' },
    metadata: incoming.metadata,
  };
  const persistedRevisionInterpretation = {
    status: 'READY',
    intent: {
      side: 'SELL', orderType: 'LIMIT', symbol: { canonical: 'XAUUSD' },
      entry: { kind: 'PRICE', value: 4275 }, stopLoss: 4390, takeProfits: [4250], incomplete: false,
    },
  };

  const result = await ingestTradingEvent(await signedInput(incoming), {
    sourceStore: { getActiveSource: async () => source },
    eventStore: {
      reserve: async () => ({ ok: true, duplicate: true, eventId: 'evt-parent', event: persistedOriginal }),
      reserveRevision: async () => ({
        ok: true,
        duplicate: true,
        revisionId: 'rev-1',
        event: persistedRevisionEvent,
        interpretation: persistedRevisionInterpretation,
      }),
      updateRevisionInterpretation: async () => { updateCalls += 1; },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.revision, true);
  assert.equal(result.revisionId, 'rev-1');
  assert.deepEqual(result.event, persistedRevisionEvent);
  assert.deepEqual(result.interpretation, persistedRevisionInterpretation);
  assert.equal(updateCalls, 0);
});
