import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ingestTradingEvent } from '../src/pipeline/ingest.js';

const SECRET = 'top-secret';
const SOURCE = {
  id: 'source-1',
  workspace_id: 'ws-1',
  source_type: 'telegram_mtproto',
  source_instance_id: 'telegram-main',
  source_family: 'telegram',
  external_identity: 'telegram-main',
  secret: SECRET,
};

function stores() {
  const state = { rows: [], updates: [], aiCalls: 0 };
  return {
    ...state,
    sourceStore: {
      getActiveSource: async (id) => id === 'source-1' ? SOURCE : null,
    },
    eventStore: {
      reserve: async (row) => {
        state.rows.push(row);
        return { ok: true, duplicate: false, eventId: 'event-1' };
      },
      updateInterpretation: async (eventId, interpretation) => {
        state.updates.push({ eventId, interpretation });
      },
    },
  };
}

async function signedInput(payload, { sourceId = 'source-1', timestamp = '1700000000', nowMs = 1700000000000 } = {}) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', SECRET).update(`${timestamp}.${sourceId}.${rawBody}`).digest('hex');
  return { rawBody, sourceId, timestamp, signature, nowMs };
}

test('authenticates source, normalizes identity and reserves durable idempotency before interpretation', async () => {
  const state = stores();
  const input = await signedInput({
    source: { type: 'anything-client-sent', instance_id: 'spoofed' },
    external_event_id: 'msg-77', text: 'BUY XAUUSD 2526 SL 2518 TP 2530',
  });
  const result = await ingestTradingEvent(input, {
    ...state,
    aiRouter: { processSignal: async () => { state.aiCalls += 1; return { success: false }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.event.workspace_hint, 'ws-1');
  assert.equal(result.event.source.type, 'telegram_mtproto');
  assert.equal(result.event.source.instance_id, 'telegram-main');
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].workspace_id, 'ws-1');
  assert.equal(state.rows[0].source_connection_id, 'source-1');
  assert.equal(state.rows[0].external_event_id, 'msg-77');
  assert.equal(state.aiCalls, 0);
  assert.equal(state.updates.length, 1);
});

test('deterministic signal does not initialize workspace AI router', async () => {
  const state = stores();
  const input = await signedInput({ external_event_id: 'msg-fast', text: 'BUY XAUUSD 2526 SL 2518 TP 2530' });
  let factoryCalls = 0;
  const result = await ingestTradingEvent(input, {
    ...state,
    aiRouterFactory: async () => {
      factoryCalls += 1;
      throw new Error('AI factory should not run for deterministic signal');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.interpretation.source, 'deterministic');
  assert.equal(factoryCalls, 0);
});

test('returns duplicate without running interpretation or any execution work', async () => {
  const state = stores();
  state.eventStore.reserve = async () => ({ ok: true, duplicate: true, eventId: 'event-existing' });
  const input = await signedInput({ external_event_id: 'msg-dupe', text: 'BUY XAUUSD 2526 SL 2518 TP 2530' });
  let aiCalls = 0;
  const result = await ingestTradingEvent(input, {
    ...state,
    aiRouter: { processSignal: async () => { aiCalls += 1; return { success: false }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.eventId, 'event-existing');
  assert.equal(result.event, undefined);
  assert.equal(result.interpretation, undefined);
  assert.equal(aiCalls, 0);
});

test('rejects invalid signature unknown source and missing external id before persistence', async () => {
  const state = stores();
  const input = await signedInput({ external_event_id: 'msg-1', text: 'BUY GOLD NOW' });
  const bad = await ingestTradingEvent({ ...input, signature: 'bad' }, { ...state });
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
