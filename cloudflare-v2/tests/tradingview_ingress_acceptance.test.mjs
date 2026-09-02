import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { handleTradingViewWebhookRequest } from '../src/http/tradingview_webhook.js';
import { createSourceEventQueue } from '../src/sources/source_event_queue.js';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { buildCanonicalSourceEventId } from '../src/sources/canonical_event_id.js';
import { signSourcePayload } from '../src/security/source_auth.js';

const NOW = Date.parse('2026-09-02T18:22:00.000Z');
const BASE = 'https://trading.example.com/api/v1/webhooks/tradingview/';

function source({ id, workspaceId, handle, scope, secret }) {
  return {
    id,
    workspace_id: workspaceId,
    workspaceId,
    source_type: 'tradingview_webhook',
    source_instance_id: scope,
    source_family: 'tradingview',
    provider_type: 'tradingview_webhook',
    external_identity: scope,
    externalIdentity: scope,
    public_source_handle: handle,
    publicSourceHandle: handle,
    is_active: true,
    secret,
  };
}

function request(handle, eventId, overrides = {}) {
  return new Request(`${BASE}${handle}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: eventId,
      text: 'BUY XAUUSD NOW SL 2500 TP 2520',
      occurred_at: '2026-09-02T18:00:00.000Z',
      metadata: { origin: 'tradingview' },
      ...overrides,
    }),
  });
}

function makeEventDependencies(sources) {
  const reservations = new Map();
  const reserveCalls = [];
  return {
    reserveCalls,
    dependencies: {
      sourceStore: {
        async getActiveSource(id) { return sources.get(id) ?? null; },
      },
      eventStore: {
        async reserve(row) {
          reserveCalls.push(structuredClone(row));
          const key = `${row.workspace_id}:${row.canonical_event_id}`;
          if (reservations.has(key)) {
            return { ok: true, duplicate: true, eventId: reservations.get(key) };
          }
          const eventId = `reserved-${reservations.size + 1}`;
          reservations.set(key, eventId);
          return { ok: true, duplicate: false, eventId };
        },
        async updateInterpretation() {},
      },
      aiRouter: { interpret: async () => null },
    },
  };
}

function makeHarness(sourceRecords) {
  const sources = new Map(sourceRecords.map((item) => [item.id, item]));
  const byHandle = new Map(sourceRecords.map((item) => [item.publicSourceHandle, item]));
  const queueMessages = [];
  const { dependencies, reserveCalls } = makeEventDependencies(sources);

  const sourceStore = {
    async getActiveTradingViewSourceByPublicHandle(handle) {
      return byHandle.get(handle) ?? null;
    },
    async getActiveSource(id) {
      return sources.get(id) ?? null;
    },
  };

  const handlerQueue = createSourceEventQueue({
    queue: { async send(message) { queueMessages.push(structuredClone(message)); } },
  });

  const consumer = createSourceEventQueue({
    sourceStore,
    dispatch: async ({ rawBody, sourceId, timestamp, signature }) => ingestTradingEvent({
      rawBody,
      sourceId,
      timestamp,
      signature,
      nowMs: Number(timestamp),
    }, dependencies),
  });

  return { sources, sourceStore, handlerQueue, consumer, queueMessages, reserveCalls };
}

async function accept(harness, req, verifyTransport = () => ({ ok: true })) {
  return handleTradingViewWebhookRequest(req, {}, {
    verifyTransport,
    sourceStore: harness.sourceStore,
    sourceQueue: harness.handlerQueue,
    nowMs: () => NOW,
  });
}

test('two TradingView handles resolve and reserve independently, including same native event id across workspaces', async () => {
  const a = source({ id: 'tv-a', workspaceId: 'ws-a', handle: 'handle-a', scope: 'strategy-shared', secret: 'secret-a' });
  const b = source({ id: 'tv-b', workspaceId: 'ws-b', handle: 'handle-b', scope: 'strategy-shared', secret: 'secret-b' });
  const harness = makeHarness([a, b]);

  const [acceptedA, acceptedB] = await Promise.all([
    accept(harness, request('handle-a', 'same-event')),
    accept(harness, request('handle-b', 'same-event')),
  ]);
  assert.equal(acceptedA.status, 202);
  assert.equal(acceptedB.status, 202);
  assert.equal(harness.queueMessages.length, 2);
  assert.deepEqual(harness.queueMessages.map((message) => message.sourceId).sort(), ['tv-a', 'tv-b']);

  const resultA = await harness.consumer.consumeSourceEvent(harness.queueMessages[0], { nowMs: NOW });
  const resultB = await harness.consumer.consumeSourceEvent(harness.queueMessages[1], { nowMs: NOW });
  assert.equal(resultA.ok, true);
  assert.equal(resultA.duplicate, false);
  assert.equal(resultB.ok, true);
  assert.equal(resultB.duplicate, false);

  assert.deepEqual(harness.reserveCalls.map((row) => [row.workspace_id, row.canonical_event_id]).sort(), [
    ['ws-a', 'tradingview:strategy-shared:same-event'],
    ['ws-b', 'tradingview:strategy-shared:same-event'],
  ]);
});

test('queue consumer re-resolves source and its secret before signed V1 dispatch', async () => {
  const a = source({ id: 'tv-a', workspaceId: 'ws-a', handle: 'handle-a', scope: 'strategy-a', secret: 'source-secret-a' });
  const harness = makeHarness([a]);
  const response = await accept(harness, request('handle-a', 'event-42'));
  assert.equal(response.status, 202);

  const message = harness.queueMessages[0];
  assert.deepEqual(Object.keys(message).sort(), ['event', 'sourceId', 'version']);
  assert.equal(message.sourceId, 'tv-a');
  assert.equal(JSON.stringify(message).includes('source-secret-a'), false);
  assert.equal(JSON.stringify(message).includes('ws-a'), false);

  const result = await harness.consumer.consumeSourceEvent(message, { nowMs: NOW });
  assert.equal(result.ok, true);
  assert.equal(harness.reserveCalls[0].workspace_id, 'ws-a');
  assert.equal(harness.reserveCalls[0].source_connection_id, 'tv-a');
});

test('malicious authority and credential hints never enter TradingView queue envelope', async () => {
  const a = source({ id: 'tv-a', workspaceId: 'ws-a', handle: 'handle-a', scope: 'strategy-a', secret: 'secret-a' });
  const harness = makeHarness([a]);
  const response = await accept(harness, request('handle-a', 'event-evil', {
    workspace_id: 'ws-attacker',
    source_connection_id: 'source-attacker',
    destination_id: 'broker-a',
    execution_enabled: true,
    structured_payload: {
      signal: 'BUY',
      broker: 'broker-b',
      nested: { password: 'private-password', safe: 'keep' },
    },
    metadata: {
      api_token: 'private-token',
      nested: { workspace: 'ws-attacker', safe: 'keep-too' },
    },
  }));
  assert.equal(response.status, 202);

  const serialized = JSON.stringify(harness.queueMessages[0]).toLowerCase();
  for (const forbidden of [
    'ws-attacker', 'source-attacker', 'broker-a', 'broker-b',
    'private-password', 'private-token', 'execution_enabled',
    'workspace_id', 'source_connection_id', 'destination_id', 'api_token', 'password',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(serialized.includes('"safe":"keep"'), true);
  assert.equal(serialized.includes('"safe":"keep-too"'), true);
});

test('source-local transport source and queue failures cannot affect a sibling TradingView source', async () => {
  const a = source({ id: 'tv-a', workspaceId: 'ws-a', handle: 'handle-a', scope: 'strategy-a', secret: 'secret-a' });
  const b = source({ id: 'tv-b', workspaceId: 'ws-b', handle: 'handle-b', scope: 'strategy-b', secret: 'secret-b' });
  const harness = makeHarness([a, b]);

  const denied = await accept(harness, request('handle-a', 'event-a'), () => ({ ok: false }));
  assert.equal(denied.status, 403);

  const missing = await accept(harness, request('missing-handle', 'event-missing'));
  assert.equal(missing.status, 404);

  const failedQueue = await handleTradingViewWebhookRequest(request('handle-a', 'event-queue-fail'), {}, {
    verifyTransport: () => ({ ok: true }),
    sourceStore: harness.sourceStore,
    sourceQueue: { async enqueueSourceEvent() { throw new Error('source A queue failure'); } },
    nowMs: () => NOW,
  });
  assert.equal(failedQueue.status, 503);

  const sibling = await accept(harness, request('handle-b', 'event-b'));
  assert.equal(sibling.status, 202);
  assert.equal(harness.queueMessages.length, 1);
  assert.equal(harness.queueMessages[0].sourceId, 'tv-b');
  const ingested = await harness.consumer.consumeSourceEvent(harness.queueMessages[0], { nowMs: NOW });
  assert.equal(ingested.ok, true);
  assert.equal(harness.reserveCalls[0].workspace_id, 'ws-b');
});

test('canonical TradingView identity remains provider scope plus stable native event id', () => {
  assert.equal(buildCanonicalSourceEventId({
    sourceFamily: 'tradingview',
    accountScope: 'strategy-a',
    nativeIdentity: { event_id: 'alert-900' },
  }), 'tradingview:strategy-a:alert-900');
});

test('existing HMAC source auth remains byte-exact and independent from TradingView transport auth', async () => {
  const rawBody = JSON.stringify({ version: '1.0', external_event_id: 'event-1' });
  const signature = await signSourcePayload(rawBody, String(NOW), 'existing-v1-secret');
  assert.match(signature, /^v1=[0-9a-f]{64}$/);
  const changed = await signSourcePayload(`${rawBody} `, String(NOW), 'existing-v1-secret');
  assert.notEqual(signature, changed);
});

test('TradingView handler remains source-only and has no destination broker or execution imports', () => {
  const url = new URL('../src/http/tradingview_webhook.js', import.meta.url);
  const sourceText = fs.readFileSync(url, 'utf8');
  assert.doesNotMatch(sourceText, /from\s+['"][^'"]*(?:destinations|brokers|execution|trade_accounts|position_groups)[^'"]*['"]/i);
  assert.match(sourceText, /createSourceEventQueue/);
  assert.doesNotMatch(sourceText, /executeTrade|dispatchOrder|broker\.execute/i);
});
