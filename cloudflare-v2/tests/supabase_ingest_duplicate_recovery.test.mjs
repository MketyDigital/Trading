import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseIngestStores } from '../src/storage/supabase_ingest_store.js';

test('duplicate reservation rehydrates persisted interpretation for safe replay', async () => {
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
        maybeSingle: async () => ({
          data: {
            id: 'evt-existing',
            processing_status: 'READY',
            canonical_intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
            error_code: null,
          },
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

  assert.match(selected, /processing_status/);
  assert.match(selected, /canonical_intent/);
  assert.deepEqual(result, {
    ok: true,
    duplicate: true,
    eventId: 'evt-existing',
    interpretation: {
      status: 'READY',
      intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
    },
  });
});

test('duplicate reservation does not invent interpretation when persisted processing is incomplete', async () => {
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
          data: { id: 'evt-existing', processing_status: null, canonical_intent: null, error_code: null },
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

  assert.deepEqual(result, { ok: true, duplicate: true, eventId: 'evt-existing' });
});
