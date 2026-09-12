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

test('loads active source connection, non-secret config and decrypts only its HMAC secret', async () => {
  const calls = [];
  let selectedColumns = '';
  const sourceResult = { data: {
    id: 'src-1', workspace_id: 'ws-1', source_type: 'telegram_mtproto', source_instance_id: 'vm-a',
    source_family: 'telegram', provider_type: 'external_mtproto', external_identity: 'telegram-account-42',
    config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-10012345'] },
    secret_ciphertext: 'v1.fake', is_active: true,
  }, error: null };
  const supabase = {
    from(table) {
      calls.push(table);
      const chain = {
        select(columns) { selectedColumns = columns; return chain; },
        eq() { return chain; },
        maybeSingle: async () => sourceResult,
      };
      return chain;
    },
  };
  const stores = createSupabaseIngestStores(supabase, {
    masterKey: 'master', decryptFn: async (cipher, key) => `${cipher}:${key}:plain`,
  });
  const source = await stores.sourceStore.getActiveSource('src-1');
  assert.equal(source.id, 'src-1');
  assert.equal(source.workspace_id, 'ws-1');
  assert.equal(source.secret, 'v1.fake:master:plain');
  assert.deepEqual(source.config, { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-10012345'] });
  assert.match(selectedColumns, /(?:^|,)config(?:,|$)/);
  assert.doesNotMatch(selectedColumns, /telegram_session|api_hash|api_id/i);
  assert.deepEqual(calls, ['source_connections']);
});

test('shared MTProto source lookup returns only matching active rows across workspaces', async () => {
  const rows = [
    {
      id: 'src-a', workspace_id: 'ws-a', source_type: 'telegram_mtproto', source_instance_id: 'a',
      source_family: 'telegram', provider_type: 'external_mtproto', external_identity: 'telegram-account-42',
      config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-10012345'] }, secret_ciphertext: 'cipher-a', is_active: true,
    },
    {
      id: 'src-b', workspace_id: 'ws-b', source_type: 'telegram_mtproto', source_instance_id: 'b',
      source_family: 'telegram', provider_type: 'external_mtproto', external_identity: 'telegram-account-42',
      config: { chat_acceptance_mode: 'all_visible', allowed_chat_ids: [] }, secret_ciphertext: 'cipher-b', is_active: true,
    },
    {
      id: 'src-c', workspace_id: 'ws-c', source_type: 'telegram_mtproto', source_instance_id: 'c',
      source_family: 'telegram', provider_type: 'external_mtproto', external_identity: 'other-account',
      config: { chat_acceptance_mode: 'all_visible', allowed_chat_ids: [] }, secret_ciphertext: 'cipher-c', is_active: true,
    },
  ];
  const supabase = {
    from(table) {
      assert.equal(table, 'source_connections');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        then(resolve) { resolve({ data: rows, error: null }); },
      };
      return chain;
    },
  };
  const { sourceStore } = createSupabaseIngestStores(supabase, {
    masterKey: 'master', decryptFn: async (cipher) => `${cipher}:plain`,
  });
  const matches = await sourceStore.findActiveExternalMtprotoSourcesForChat('-10012345', { externalIdentity: 'telegram-account-42' });
  assert.deepEqual(matches.map((row) => [row.id, row.workspace_id, row.secret]), [
    ['src-a', 'ws-a', 'cipher-a:plain'],
    ['src-b', 'ws-b', 'cipher-b:plain'],
  ]);
});

test('shared MTProto source lookup throws on database failure instead of converting outage into zero matches', async () => {
  const supabase = {
    from(table) {
      assert.equal(table, 'source_connections');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        then(resolve) { resolve({ data: null, error: { message: 'database unavailable' } }); },
      };
      return chain;
    },
  };
  const { sourceStore } = createSupabaseIngestStores(supabase, { masterKey: 'master', decryptFn: async () => 'secret' });
  await assert.rejects(
    sourceStore.findActiveExternalMtprotoSourcesForChat('-10012345'),
    /EXTERNAL_MTPROTO_SOURCE_LOOKUP_FAILED/,
  );
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
