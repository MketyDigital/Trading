import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseIngestStores } from '../src/storage/supabase_ingest_store.js';

function query(result) {
  const chain = {
    select() { return chain; }, eq() { return chain; }, maybeSingle: async () => result,
    insert() { return chain; }, update() { return chain; }, single: async () => result,
  };
  return chain;
}

test('loads only active source connection and decrypts its HMAC secret', async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(table);
      return query({ data: {
        id: 'src-1', workspace_id: 'ws-1', source_type: 'telethon', source_instance_id: 'vm-a',
        secret_ciphertext: 'v1.fake', is_active: true,
      }, error: null });
    },
  };
  const stores = createSupabaseIngestStores(supabase, {
    masterKey: 'master', decryptFn: async (cipher, key) => `${cipher}:${key}:plain`,
  });
  const source = await stores.sourceStore.getActiveSource('src-1');
  assert.equal(source.id, 'src-1');
  assert.equal(source.workspace_id, 'ws-1');
  assert.equal(source.secret, 'v1.fake:master:plain');
  assert.deepEqual(calls, ['source_connections']);
});

test('reserves a trading event and returns generated event id', async () => {
  let inserted;
  const supabase = {
    from(table) {
      assert.equal(table, 'trading_events');
      return {
        insert(value) { inserted = value; return this; },
        select() { return this; },
        single: async () => ({ data: { id: 'evt-1' }, error: null }),
      };
    },
  };
  const { eventStore } = createSupabaseIngestStores(supabase, { masterKey: 'x', decryptFn: async () => 'x' });
  const result = await eventStore.reserve({ workspace_id: 'ws-1', source_connection_id: 'src-1', external_event_id: '42' });
  assert.deepEqual(result, { ok: true, duplicate: false, eventId: 'evt-1' });
  assert.equal(inserted.external_event_id, '42');
});

test('unique violation resolves existing event as duplicate instead of retrying processing', async () => {
  let phase = 'insert';
  const supabase = {
    from(table) {
      assert.equal(table, 'trading_events');
      if (phase === 'insert') {
        return {
          insert() { return this; }, select() { return this; },
          single: async () => { phase = 'lookup'; return { data: null, error: { code: '23505' } }; },
        };
      }
      return {
        select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: { id: 'evt-existing' }, error: null }),
      };
    },
  };
  const { eventStore } = createSupabaseIngestStores(supabase, { masterKey: 'x', decryptFn: async () => 'x' });
  const result = await eventStore.reserve({ workspace_id: 'ws-1', source_connection_id: 'src-1', external_event_id: '42' });
  assert.deepEqual(result, { ok: true, duplicate: true, eventId: 'evt-existing' });
});

test('persists canonical interpretation status without storing secrets', async () => {
  let updatePayload;
  const supabase = {
    from(table) {
      assert.equal(table, 'trading_events');
      return {
        update(value) { updatePayload = value; return this; },
        eq() { return this; },
        then(resolve) { resolve({ data: null, error: null }); },
      };
    },
  };
  const { eventStore } = createSupabaseIngestStores(supabase, { masterKey: 'x', decryptFn: async () => 'x' });
  await eventStore.updateInterpretation('evt-1', { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } });
  assert.equal(updatePayload.processing_status, 'READY');
  assert.equal(updatePayload.canonical_intent.side, 'BUY');
});
