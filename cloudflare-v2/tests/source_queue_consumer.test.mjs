import test from 'node:test';
import assert from 'node:assert/strict';

import { createSourceQueueConsumer } from '../src/sources/source_queue_consumer.js';

function queuedBody() {
  return {
    version: 'mkety.source-event.v1',
    sourceId: 'src-telegram-1',
    event: {
      source_external_id: 'telegram-account-42',
      external_event_id: 'telegram:-1001:77',
      occurred_at: '2026-09-02T07:00:00.000Z',
      text: 'BUY GOLD NOW',
      structured_payload: {},
      thread: {},
      metadata: { native_identity: { chat_id: '-1001', message_id: '77' } },
    },
  };
}

function message(body = queuedBody()) {
  return {
    body,
    acked: 0,
    retried: 0,
    ack() { this.acked += 1; },
    retry() { this.retried += 1; },
  };
}

test('worker queue consumer resolves source server-side, dispatches V1 and acknowledges success', async () => {
  const msg = message();
  const seen = [];
  const consumer = createSourceQueueConsumer({
    async sourceResolver(sourceId) {
      assert.equal(sourceId, 'src-telegram-1');
      return {
        id: sourceId,
        source_type: 'telegram_mtproto',
        source_instance_id: 'telegram-account-42',
        external_identity: 'telegram-account-42',
        secret: 'server-only-secret',
      };
    },
    async dispatch(request) {
      seen.push(request);
      return { ok: true, duplicate: false, eventId: 'evt-1' };
    },
    now: () => 1_788_333_600_000,
  });

  const result = await consumer({ messages: [msg] });

  assert.deepEqual(result, { processed: 1, acknowledged: 1, retried: 0 });
  assert.equal(msg.acked, 1);
  assert.equal(msg.retried, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].sourceId, 'src-telegram-1');
  assert.equal(JSON.stringify(seen[0]).includes('server-only-secret'), false);
});

test('worker queue consumer treats duplicate as success and retries downstream or source failures', async () => {
  const duplicate = message();
  const failed = message({ ...queuedBody(), sourceId: 'src-failed' });
  const missing = message({ ...queuedBody(), sourceId: 'src-missing' });

  const consumer = createSourceQueueConsumer({
    async sourceResolver(sourceId) {
      if (sourceId === 'src-missing') return null;
      return {
        id: sourceId,
        source_type: 'telegram_mtproto',
        source_instance_id: 'telegram-account-42',
        external_identity: 'telegram-account-42',
        secret: 'server-only-secret',
      };
    },
    async dispatch(request) {
      if (request.sourceId === 'src-failed') return { ok: false, reason: 'V1_DOWNSTREAM_UNAVAILABLE' };
      return { ok: true, duplicate: true, eventId: 'evt-existing' };
    },
  });

  const result = await consumer({ messages: [duplicate, failed, missing] });

  assert.deepEqual(result, { processed: 3, acknowledged: 1, retried: 2 });
  assert.equal(duplicate.acked, 1);
  assert.equal(failed.retried, 1);
  assert.equal(missing.retried, 1);
});
