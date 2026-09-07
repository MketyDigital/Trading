import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseIngestStores } from '../src/storage/supabase_ingest_store.js';

function sourceQuery(result, selectLog) {
  const chain = {
    select(columns) { selectLog.push(columns); return chain; },
    eq() { return chain; },
    maybeSingle: async () => result,
  };
  return chain;
}

test('authenticated source store exposes provider family and non-secret canonical scope', async () => {
  const selects = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'source_connections');
      return sourceQuery({
        data: {
          id: 'src-1', workspace_id: 'ws-1', source_type: 'telegram_mtproto', source_instance_id: 'container-a',
          source_family: 'telegram', provider_type: 'cloudflare_container_mtproto', external_identity: 'telegram-account-42',
          secret_ciphertext: 'v1.fake', settings: {}, is_active: true,
        },
        error: null,
      }, selects);
    },
  };

  const { sourceStore } = createSupabaseIngestStores(supabase, {
    masterKey: 'master',
    decryptFn: async () => 'plain-secret',
  });
  const source = await sourceStore.getActiveSource('src-1');

  assert.equal(source.source_family, 'telegram');
  assert.equal(source.provider_type, 'cloudflare_container_mtproto');
  assert.equal(source.external_identity, 'telegram-account-42');
  assert.equal(source.secret, 'plain-secret');
  assert.match(selects[0], /source_family/);
  assert.match(selects[0], /provider_type/);
  assert.match(selects[0], /external_identity/);
});

test('canonical unique violation looks up duplicate without requiring the same provider connection', async () => {
  let phase = 'insert';
  const equalityCalls = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'trading_events');
      if (phase === 'insert') {
        return {
          insert() { return this; },
          select() { return this; },
          single: async () => {
            phase = 'lookup';
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          },
        };
      }
      const query = {
        select() { return query; },
        eq(column, value) { equalityCalls.push([column, value]); return query; },
        maybeSingle: async () => ({ data: { id: 'evt-existing' }, error: null }),
      };
      return query;
    },
  };

  const { eventStore } = createSupabaseIngestStores(supabase, {
    masterKey: 'master',
    decryptFn: async () => 'secret',
  });
  const result = await eventStore.reserve({
    workspace_id: 'ws-1',
    source_connection_id: 'src-do',
    external_event_id: 'do-local-12',
    canonical_event_id: 'telegram:telegram-account-42:-10012345:9876',
  });

  assert.deepEqual(result, { ok: true, duplicate: true, eventId: 'evt-existing' });
  assert.deepEqual(equalityCalls, [
    ['workspace_id', 'ws-1'],
    ['canonical_event_id', 'telegram:telegram-account-42:-10012345:9876'],
  ]);
});

test('legacy source-scoped duplicate lookup remains available when canonical identity is absent', async () => {
  let phase = 'insert';
  const equalityCalls = [];
  const supabase = {
    from() {
      if (phase === 'insert') {
        return {
          insert() { return this; }, select() { return this; },
          single: async () => { phase = 'lookup'; return { data: null, error: { code: '23505' } }; },
        };
      }
      const query = {
        select() { return query; },
        eq(column, value) { equalityCalls.push([column, value]); return query; },
        maybeSingle: async () => ({ data: { id: 'legacy-event' }, error: null }),
      };
      return query;
    },
  };
  const { eventStore } = createSupabaseIngestStores(supabase, { masterKey: 'x', decryptFn: async () => 'x' });
  const result = await eventStore.reserve({ workspace_id: 'ws-1', source_connection_id: 'legacy-src', external_event_id: '42' });
  assert.equal(result.duplicate, true);
  assert.deepEqual(equalityCalls, [
    ['workspace_id', 'ws-1'],
    ['source_connection_id', 'legacy-src'],
    ['external_event_id', '42'],
  ]);
});
