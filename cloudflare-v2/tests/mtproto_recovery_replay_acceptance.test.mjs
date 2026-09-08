import test from 'node:test';
import assert from 'node:assert/strict';

import { createSourceQueueConsumer } from '../src/sources/source_queue_consumer.js';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';

const NOW = 1700000000000;

const SOURCES = {
  'src-container': {
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
  'src-do': {
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

function createPersistentState() {
  const canonicalReservations = new Map();
  let interpretations = 0;
  let orchestrationCalls = 0;

  return {
    get interpretationCount() { return interpretations; },
    get orchestrationCount() { return orchestrationCalls; },
    sourceStore: {
      async getActiveSource(sourceId) {
        return SOURCES[sourceId] || null;
      },
    },
    eventStore: {
      async reserve(row) {
        const key = row.canonical_event_id || `${row.source_connection_id}:${row.external_event_id}`;
        if (canonicalReservations.has(key)) {
          return { ok: true, duplicate: true, eventId: canonicalReservations.get(key) };
        }
        const eventId = `evt-${canonicalReservations.size + 1}`;
        canonicalReservations.set(key, eventId);
        return { ok: true, duplicate: false, eventId };
      },
      async updateInterpretation() {
        interpretations += 1;
      },
    },
    markOrchestration() {
      orchestrationCalls += 1;
    },
  };
}

function telegramQueueBody(sourceId, messageId) {
  const chatId = '-10012345';
  return {
    version: 'mkety.source-event.v1',
    sourceId,
    event: {
      source_external_id: chatId,
      external_event_id: `telegram:${chatId}:${messageId}`,
      occurred_at: '2026-09-02T09:00:00.000Z',
      text: 'BUY XAUUSD 2526 SL 2518 TP 2530',
      structured_payload: {},
      thread: {},
      metadata: {
        native_identity: {
          chat_id: chatId,
          message_id: String(messageId),
        },
      },
    },
  };
}

function queueMessage(body) {
  const state = { acked: 0, retried: 0 };
  return {
    body,
    state,
    ack() { state.acked += 1; },
    retry() { state.retried += 1; },
  };
}

function createConsumer(state) {
  return createSourceQueueConsumer({
    sourceResolver: async (sourceId) => SOURCES[sourceId] || null,
    now: () => NOW,
    dispatch: async (signed) => {
      const result = await ingestTradingEvent({ ...signed, nowMs: NOW }, state);
      if (result.ok && !result.duplicate) state.markOrchestration();
      return result;
    },
  });
}

test('post-restart replay of exact Telegram native message is ACKed as duplicate with zero second orchestration', async () => {
  const state = createPersistentState();
  const consume = createConsumer(state);
  const first = queueMessage(telegramQueueBody('src-container', '9876'));
  const replayAfterRecovery = queueMessage(telegramQueueBody('src-container', '9876'));

  const firstResult = await consume({ messages: [first] });
  const replayResult = await consume({ messages: [replayAfterRecovery] });

  assert.deepEqual(firstResult, { processed: 1, acknowledged: 1, retried: 0 });
  assert.deepEqual(replayResult, { processed: 1, acknowledged: 1, retried: 0 });
  assert.equal(first.state.acked, 1);
  assert.equal(replayAfterRecovery.state.acked, 1);
  assert.equal(replayAfterRecovery.state.retried, 0);
  assert.equal(state.interpretationCount, 1);
  assert.equal(state.orchestrationCount, 1);
});

test('new Telegram message id after recovery remains distinct and proceeds once', async () => {
  const state = createPersistentState();
  const consume = createConsumer(state);
  const beforeRestart = queueMessage(telegramQueueBody('src-container', '9876'));
  const afterRestartNewSignal = queueMessage(telegramQueueBody('src-container', '9877'));

  await consume({ messages: [beforeRestart] });
  const result = await consume({ messages: [afterRestartNewSignal] });

  assert.deepEqual(result, { processed: 1, acknowledged: 1, retried: 0 });
  assert.equal(afterRestartNewSignal.state.acked, 1);
  assert.equal(state.interpretationCount, 2);
  assert.equal(state.orchestrationCount, 2);
});

test('redundant Telegram provider replay after recovery converges on same native identity and is ACKed without second work', async () => {
  const state = createPersistentState();
  const consume = createConsumer(state);
  const containerDelivery = queueMessage(telegramQueueBody('src-container', '9876'));
  const redundantDoReplay = queueMessage(telegramQueueBody('src-do', '9876'));

  await consume({ messages: [containerDelivery] });
  const result = await consume({ messages: [redundantDoReplay] });

  assert.deepEqual(result, { processed: 1, acknowledged: 1, retried: 0 });
  assert.equal(redundantDoReplay.state.acked, 1);
  assert.equal(redundantDoReplay.state.retried, 0);
  assert.equal(state.interpretationCount, 1);
  assert.equal(state.orchestrationCount, 1);
});
