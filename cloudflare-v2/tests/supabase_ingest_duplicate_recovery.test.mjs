import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseIngestStores } from '../src/storage/supabase_ingest_store.js';

const persistedRow = {
  id: 'evt-existing',
  event_version: '1.0',
  source_type: 'custom_api',
  source_external_id: 'customer-api-1',
  external_event_id: 'native-1',
  occurred_at: '2026-09-05T20:00:00.000Z',
  created_at: '2026-09-05T20:00:01.000Z',
  raw_text: 'BUY XAUUSD',
  structured_payload: {},
  thread: { thread_id: 'original-thread', reply_to_event_id: null, edited_event_id: null },
  metadata: { original: true },
  processing_status: 'READY',
  canonical_intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
  error_code: null,
};

test('duplicate reservation rehydrates persisted event and interpretation for safe replay', async () => {
  let phase = 'insert';
  let selected = '';
  const supabase = {
    from(table) {
      assert.equal(table, 'trading_events');
      if (phase === 'insert') {
        return {
          insert() { return this; },
          select() { return this; },
          single: async () => {
            phase = 'lookup';
            return { data: null, error: { code: '23505' } };
          },
        };
      }
      return {
        select(columns) { selected = columns; return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: persistedRow, error: null }),
      };
    },
  };

  const { eventStore } = createSupabaseIngestStores(supabase, {
    masterKey: 'master',
    decryptFn: async () => 'secret',
  });
  const result = await eventStore.reserve({
    workspace_id: 'ws-1',
    source_connection_id: 'src-1',
    external_event_id: 'native-1',
  });

  assert.match(selected, /processing_status/);
  assert.match(selected, /canonical_intent/);
  assert.match(selected, /raw_text/);
  assert.match(selected, /thread/);
  assert.deepEqual(result, {
    ok: true,
    duplicate: true,
    eventId: 'evt-existing',
    event: {
      version: '1.0',
      source_type: 'custom_api',
      source_external_id: 'customer-api-1',
      external_event_id: 'native-1',
      occurred_at: '2026-09-05T20:00:00.000Z',
      received_at: '2026-09-05T20:00:01.000Z',
      text: 'BUY XAUUSD',
      structured_payload: {},
      thread: { thread_id: 'original-thread', reply_to_event_id: null, edited_event_id: null },
      metadata: { original: true },
    },
    interpretation: {
      status: 'READY',
      intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
    },
  });
});

test('duplicate reservation returns persisted event without inventing interpretation when processing is incomplete', async () => {
  let phase = 'insert';
  const supabase = {
    from() {
      if (phase === 'insert') {
        return {
          insert() { return this; },
          select() { return this; },
          single: async () => {
            phase = 'lookup';
            return { data: null, error: { code: '23505' } };
          },
        };
      }
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({
          data: { ...persistedRow, processing_status: null, canonical_intent: null, error_code: null },
          error: null,
        }),
      };
    },
  };

  const { eventStore } = createSupabaseIngestStores(supabase, {
    masterKey: 'master',
    decryptFn: async () => 'secret',
  });
  const result = await eventStore.reserve({
    workspace_id: 'ws-1',
    source_connection_id: 'src-1',
    external_event_id: 'native-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.eventId, 'evt-existing');
  assert.equal(result.interpretation, undefined);
  assert.equal(result.event.text, 'BUY XAUUSD');
  assert.equal(result.event.thread.thread_id, 'original-thread');
});
