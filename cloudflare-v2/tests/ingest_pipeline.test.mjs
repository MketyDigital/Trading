import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';
import { signSourcePayload } from '../src/security/source_auth.js';

function stores({ duplicate = false } = {}) {
  const reservations = [];
  return {
    reservations,
    sourceStore: {
      getActiveSource: async (sourceId) => sourceId === 'source-1' ? {
        id: 'source-db-1', workspace_id: 'ws-1', source_instance_id: 'source-1', source_type: 'custom_webhook', secret: 'shared-secret'
      } : null,
    },
    eventStore: {
      reserve: async (event) => {
        reservations.push(event);
        return duplicate ? { ok: false, duplicate: true, eventId: 'existing' } : { ok: true, duplicate: false, eventId: 'event-1' };
      },
      updateInterpretation: async () => {},
    },
  };
}

async function signedInput(payload, now = 1700000000000) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    sourceId: 'source-1',
    timestamp: String(now),
    signature: await signSourcePayload(rawBody, String(now), 'shared-secret'),
    nowMs: now,
  };
}

test('authenticates source, normalizes identity and reserves durable idempotency before interpretation', async () => {
  const state = stores();
  const input = await signedInput({
    source: { type: 'anything-client-sent', instance_id: 'spoofed' },
    external_event_id: 'msg-77', text: 'BUY XAUUSD 2526 SL 2518 TP 2530',
  });
  const result = await ingestTradingEvent(input, {
    ...state,
    aiRouter: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.event.workspace_hint, 'ws-1');
  assert.equal(result.event.source.type, 'custom_webhook');
  assert.equal(result.event.source.instance_id, 'source-1');
  assert.equal(state.reservations[0].external_event_id, 'msg-77');
  assert.equal(result.interpretation.status, 'READY');
});

test('deterministic signal does not initialize workspace AI router', async () => {
  const state = stores();
  const input = await signedInput({
    external_event_id: 'msg-fast', text: 'BUY XAUUSD 2526 SL 2518 TP 2530 2535',
  });
  let aiFactoryCalls = 0;
  const result = await ingestTradingEvent(input, {
    ...state,
    aiRouterFactory: async () => {
      aiFactoryCalls += 1;
      throw new Error('AI router must not initialize on deterministic hot path');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(result.interpretation.source, 'deterministic');
  assert.equal(aiFactoryCalls, 0);
});

test('returns duplicate without running interpretation or any execution work', async () => {
  const state = stores({ duplicate: true });
  let aiCalled = false;
  const input = await signedInput({ external_event_id: 'msg-77', text: 'strange trade text' });
  const result = await ingestTradingEvent(input, {
    ...state,
    aiRouter: { processSignal: async () => { aiCalled = true; return { success: false }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(aiCalled, false);
});

test('rejects invalid signature unknown source and missing external id before persistence', async () => {
  const state = stores();
  const input = await signedInput({ external_event_id: 'msg-1', text: 'BUY GOLD NOW' });
  const bad = await ingestTradingEvent({ ...input, signature: 'v1=bad' }, { ...state });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);

  const unknown = await ingestTradingEvent({ ...input, sourceId: 'missing' }, { ...state });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 401);

  const missingId = await signedInput({ text: 'BUY GOLD NOW' });
  const malformed = await ingestTradingEvent(missingId, { ...state });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.status, 400);
});

test('loads AI only after authenticated source establishes trusted workspace', async () => {
  const state = stores();
  const input = await signedInput({
    external_event_id: 'msg-ai',
    text: 'Buy gold if this setup is confirmed. Entry 2526, risk 2518, objectives 2530 and 2535',
  });
  let factoryContext;
  const result = await ingestTradingEvent(input, {
    ...state,
    aiRouterFactory: async (context) => {
      factoryContext = context;
      return {
        processSignal: async () => ({ success: true, provider: 'tenant-fast-ai', model: 'fast', text: JSON.stringify({
          event_type: 'NEW_SIGNAL', side: 'BUY', symbol: 'GOLD', order_type: 'MARKET',
          entry: 2526, stop_loss: 2518, take_profits: [2530, 2535],
        }) }),
      };
    },
  });
  assert.equal(factoryContext.source.workspace_id, 'ws-1');
  assert.equal(factoryContext.event.workspace_hint, 'ws-1');
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(result.interpretation.source, 'ai');
});
