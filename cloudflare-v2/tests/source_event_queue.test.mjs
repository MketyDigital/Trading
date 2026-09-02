import test from 'node:test';
import assert from 'node:assert/strict';

import { createSourceEventQueue } from '../src/sources/source_event_queue.js';

function source(overrides = {}) {
  return {
    id: 'src-telegram-1',
    workspace_id: 'ws-1',
    source_type: 'telegram_mtproto',
    source_instance_id: 'telegram-account-42',
    source_family: 'telegram',
    provider_type: 'cloudflare_container_mtproto',
    external_identity: 'telegram-account-42',
    secret: 'server-only-source-secret',
    ...overrides,
  };
}

function nativeEvent(overrides = {}) {
  return {
    source_id: 'src-telegram-1',
    source_external_id: 'telegram-account-42',
    external_event_id: 'telegram:-1001:77',
    occurred_at: '2026-09-02T07:00:00.000Z',
    text: 'BUY GOLD NOW',
    metadata: {
      native_identity: { chat_id: '-1001', message_id: '77' },
      account_scope: 'telegram-account-42',
      media: false,
    },
    ...overrides,
  };
}

test('enqueue hands off compact native event immediately without decrypted secrets', async () => {
  const sent = [];
  const queue = { async send(payload) { sent.push(payload); } };
  const transport = createSourceEventQueue({ queue });

  const result = await transport.enqueueSourceEvent(source(), nativeEvent());

  assert.deepEqual(result, { queued: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sourceId, 'src-telegram-1');
  assert.deepEqual(sent[0].event.metadata.native_identity, { chat_id: '-1001', message_id: '77' });
  assert.equal(JSON.stringify(sent[0]).includes('server-only-source-secret'), false);
});

test('consumer resolves registered source server-side and signs exact V1 body before dispatch', async () => {
  const dispatched = [];
  const sourceStore = {
    async getActiveSource(id) {
      assert.equal(id, 'src-telegram-1');
      return source();
    },
  };
  const transport = createSourceEventQueue({
    queue: { async send() {} },
    sourceStore,
    async dispatch(request) {
      dispatched.push(request);
      return { ok: true, duplicate: false, eventId: 'evt-1' };
    },
  });

  const result = await transport.consumeSourceEvent({ sourceId: 'src-telegram-1', event: nativeEvent() }, { nowMs: 1_788_333_600_000 });

  assert.equal(result.ok, true);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].sourceId, 'src-telegram-1');
  assert.match(dispatched[0].signature, /^v1=[a-f0-9]{64}$/);
  assert.equal(dispatched[0].timestamp, '1788333600000');
  const body = JSON.parse(dispatched[0].rawBody);
  assert.equal(body.text, 'BUY GOLD NOW');
  assert.deepEqual(body.metadata.native_identity, { chat_id: '-1001', message_id: '77' });
  assert.equal(JSON.stringify(body).includes('server-only-source-secret'), false);
});

test('duplicate V1 result is successful queue consumption and never asks listener to resend', async () => {
  let dispatches = 0;
  const transport = createSourceEventQueue({
    queue: { async send() {} },
    sourceStore: { async getActiveSource() { return source(); } },
    async dispatch() {
      dispatches += 1;
      return { ok: true, duplicate: true, eventId: 'evt-existing' };
    },
  });

  const result = await transport.consumeSourceEvent({ sourceId: 'src-telegram-1', event: nativeEvent() });

  assert.equal(result.duplicate, true);
  assert.equal(dispatches, 1);
});

test('consumer fails closed for unknown/inactive source and retries downstream failures', async () => {
  const unknown = createSourceEventQueue({
    queue: { async send() {} },
    sourceStore: { async getActiveSource() { return null; } },
    async dispatch() { throw new Error('must not dispatch'); },
  });
  await assert.rejects(
    () => unknown.consumeSourceEvent({ sourceId: 'src-missing', event: nativeEvent() }),
    /unknown or inactive source/i,
  );

  const failing = createSourceEventQueue({
    queue: { async send() {} },
    sourceStore: { async getActiveSource() { return source(); } },
    async dispatch() { return { ok: false, status: 503, reason: 'EVENT_RESERVATION_FAILED' }; },
  });
  await assert.rejects(
    () => failing.consumeSourceEvent({ sourceId: 'src-telegram-1', event: nativeEvent() }),
    /source event dispatch failed/i,
  );
});
