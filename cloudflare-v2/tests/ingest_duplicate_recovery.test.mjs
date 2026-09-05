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

test('duplicate ingest returns persisted canonical interpretation for safe internal replay', async () => {
  const input = await signedInput(rawBody);
  const result = await ingestTradingEvent(input, {
    sourceStore: { async getActiveSource() { return source; } },
    eventStore: {
      async reserve() {
        return {
          ok: true,
          duplicate: true,
          eventId: 'evt-existing',
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
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(result.interpretation.intent.side, 'BUY');
});

test('duplicate ingest repairs a missing interpretation before returning replay context', async () => {
  const input = await signedInput(rawBody);
  let persisted;
  let aiCalls = 0;
  const result = await ingestTradingEvent(input, {
    sourceStore: { async getActiveSource() { return source; } },
    eventStore: {
      async reserve() { return { ok: true, duplicate: true, eventId: 'evt-existing' }; },
      async updateInterpretation(_eventId, interpretation) { persisted = interpretation; },
    },
    aiRouter: {
      async interpret() {
        aiCalls += 1;
        return {
          status: 'READY',
          intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' }, order_type: 'MARKET' },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(aiCalls, 1);
  assert.equal(result.interpretation.status, 'READY');
  assert.equal(persisted.status, 'READY');
});
