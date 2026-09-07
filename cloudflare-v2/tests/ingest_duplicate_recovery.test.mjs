import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

async function signedInput(rawBody, secret = 'secret') {
  const timestamp = '1700000000000';
  return {
    rawBody,
    sourceId: 'src-1',
    timestamp,
    signature: await signSourcePayload(rawBody, timestamp, secret),
    nowMs: 1700000000000,
  };
}

const source = {
  id: 'src-1',
  secret: 'secret',
  workspace_id: 'ws-1',
  source_type: 'custom_api',
  source_instance_id: 'src-1',
  source_family: 'custom_signed_api',
  external_identity: 'customer-api-1',
};

const rawBody = JSON.stringify({
  version: '1.0',
  source: { type: 'custom_api', instance_id: 'client-ignored', external_id: 'customer-api-1' },
  external_event_id: 'native-1',
  occurred_at: '2026-09-05T20:00:00.000Z',
  received_at: '2026-09-05T20:00:00.000Z',
  text: 'BUY XAUUSD',
  structured_payload: {},
  thread: {},
  metadata: {},
});

const persistedEvent = {
  version: '1.0',
  workspace_hint: 'ws-1',
  source: { type: 'custom_api', instance_id: 'src-1', external_id: 'customer-api-1' },
  external_event_id: 'native-1',
  occurred_at: '2026-09-05T20:00:00.000Z',
  received_at: '2026-09-05T20:00:01.000Z',
  text: 'BUY XAUUSD',
  structured_payload: {},
  thread: { thread_id: 'original-thread', reply_to_event_id: null, edited_event_id: null },
  metadata: { original: true },
};

test('duplicate ingest returns persisted event and interpretation for safe internal replay', async () => {
  const replayBody = JSON.stringify({
    ...JSON.parse(rawBody),
    text: 'SELL EURUSD',
    thread: { thread_id: 'attacker-thread', reply_to_event_id: 'different-event' },
    metadata: { replay: true },
  });
  const input = await signedInput(replayBody);
  const result = await ingestTradingEvent(input, {
    sourceStore: { async getActiveSource() { return source; } },
    eventStore: {
      async reserve() {
        return {
          ok: true,
          duplicate: true,
          eventId: 'evt-existing',
          event: persistedEvent,
          interpretation: {
            status: 'READY',
            intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.eventId, 'evt-existing');
  assert.deepEqual(result.event, persistedEvent);
  assert.equal(result.event.thread.thread_id, 'original-thread');
  assert.equal(result.event.thread.reply_to_event_id, null);
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(result.interpretation.intent.side, 'BUY');
});

test('duplicate ingest repairs missing interpretation from persisted event, never replay body', async () => {
  const replayBody = JSON.stringify({
    ...JSON.parse(rawBody),
    text: 'SELL EURUSD',
    thread: { thread_id: 'attacker-thread', reply_to_event_id: 'different-event' },
  });
  const input = await signedInput(replayBody);
  let persisted;
  let aiInput;
  const result = await ingestTradingEvent(input, {
    sourceStore: { async getActiveSource() { return source; } },
    eventStore: {
      async reserve() {
        return { ok: true, duplicate: true, eventId: 'evt-existing', event: persistedEvent };
      },
      async updateInterpretation(_eventId, interpretation) { persisted = interpretation; },
    },
    aiRouter: {
      async processSignal(text) {
        aiInput = text;
        return {
          success: true,
          provider: 'test',
          model: 'test',
          text: JSON.stringify({
            event_type: 'NEW_SIGNAL',
            side: 'BUY',
            symbol: 'XAUUSD',
            order_type: 'MARKET',
            entry: null,
            stop_loss: 2400,
            take_profits: [2600],
            fast_entry: false,
          }),
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.event, persistedEvent);
  assert.equal(aiInput, 'BUY XAUUSD');
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(persisted.status, 'READY');
});

test('duplicate ingest re-interprets incomplete persisted interpretation from persisted event', async () => {
  const replayBody = JSON.stringify({
    ...JSON.parse(rawBody),
    text: 'SELL EURUSD',
    thread: { thread_id: 'attacker-thread', reply_to_event_id: 'different-event' },
  });
  const input = await signedInput(replayBody);
  const staleInterpretation = {
    status: 'PENDING',
    intent: { side: 'SELL', symbol: { canonical: 'EURUSD' } },
  };
  let aiCalls = 0;
  let aiInput;
  let persistedEventId;
  let repairedInterpretation;

  const result = await ingestTradingEvent(input, {
    sourceStore: { async getActiveSource() { return source; } },
    eventStore: {
      async reserve() {
        return {
          ok: true,
          duplicate: true,
          eventId: 'evt-existing',
          event: persistedEvent,
          interpretation: staleInterpretation,
          needsInterpretation: true,
        };
      },
      async updateInterpretation(eventId, interpretation) {
        persistedEventId = eventId;
        repairedInterpretation = interpretation;
      },
    },
    aiRouter: {
      async processSignal(text) {
        aiCalls += 1;
        aiInput = text;
        return {
          success: true,
          provider: 'test',
          model: 'test',
          text: JSON.stringify({
            event_type: 'NEW_SIGNAL',
            side: 'BUY',
            symbol: 'XAUUSD',
            order_type: 'MARKET',
            entry: null,
            stop_loss: 2400,
            take_profits: [2600],
            fast_entry: false,
          }),
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.recoveryReady, true);
  assert.equal(aiCalls, 1);
  assert.equal(aiInput, 'BUY XAUUSD');
  assert.equal(persistedEventId, 'evt-existing');
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(result.interpretation.intent.side, 'BUY');
  assert.equal(repairedInterpretation.status, 'READY');
  assert.notDeepEqual(result.interpretation, staleInterpretation);
});
