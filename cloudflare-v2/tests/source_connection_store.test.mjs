import test from 'node:test';
import assert from 'node:assert/strict';

import { createSourceConnectionStore } from '../src/sources/source_connection_store.js';

function makeListQuery(rows) {
  const filters = [];
  const query = {
    select() { return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    order() { return query; },
    then(resolve) {
      let data = rows;
      for (const [column, value] of filters) {
        data = data.filter((row) => row[column] === value);
      }
      resolve({ data, error: null });
    },
  };
  return query;
}

test('lists multiple enabled source families and providers without requiring a default', async () => {
  const rows = [
    { id: 'tg-container', workspace_id: 'ws-1', provider_type: 'cloudflare_container_mtproto', source_family: 'telegram', is_active: true, is_default: true, priority: 10 },
    { id: 'tg-external', workspace_id: 'ws-1', provider_type: 'external_mtproto', source_family: 'telegram', is_active: true, is_default: false, priority: 20 },
    { id: 'mt5-a', workspace_id: 'ws-1', provider_type: 'mt5_source_bridge', source_family: 'mt5', is_active: true, is_default: true, priority: 10 },
    { id: 'tv-a', workspace_id: 'ws-1', provider_type: 'tradingview_webhook', source_family: 'tradingview', is_active: false, is_default: false, priority: 10 },
  ];
  const supabase = { from: () => makeListQuery(rows) };
  const store = createSourceConnectionStore(supabase);

  const active = await store.listEnabledSources('ws-1');
  assert.deepEqual(active.map((source) => source.id), ['tg-container', 'mt5-a', 'tg-external']);
  assert.equal(active.filter((source) => source.sourceFamily === 'telegram').length, 2);
});

test('unconfigured workspace has an empty enabled-source list', async () => {
  const supabase = { from: () => makeListQuery([]) };
  const store = createSourceConnectionStore(supabase);
  assert.deepEqual(await store.listEnabledSources('ws-empty'), []);
});

test('setDefaultSource delegates atomic family switch to one Trading-owned rpc', async () => {
  const rpcCalls = [];
  const supabase = {
    rpc: async (name, args) => {
      rpcCalls.push([name, args]);
      return { data: { id: 'tg-external' }, error: null };
    },
  };
  const store = createSourceConnectionStore(supabase);

  const result = await store.setDefaultSource('ws-1', 'telegram', 'tg-external');
  assert.equal(result.id, 'tg-external');
  assert.deepEqual(rpcCalls, [[
    'trading_set_default_source',
    { p_workspace_id: 'ws-1', p_source_family: 'telegram', p_source_id: 'tg-external' },
  ]]);
});

test('setDefaultSource fails closed when atomic rpc rejects the target', async () => {
  const supabase = {
    rpc: async () => ({ data: null, error: { message: 'source not enabled for workspace/family' } }),
  };
  const store = createSourceConnectionStore(supabase);
  await assert.rejects(
    () => store.setDefaultSource('ws-1', 'telegram', 'wrong-source'),
    /source not enabled/i,
  );
});

test('disabling a source clears its default flag without touching alternatives', async () => {
  let payload;
  const filters = [];
  const query = {
    update(value) { payload = value; return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    select() { return query; },
    maybeSingle: async () => ({ data: { id: 'tg-container', workspace_id: 'ws-1', provider_type: 'cloudflare_container_mtproto', source_family: 'telegram', is_active: false, is_default: false, priority: 10 }, error: null }),
  };
  const supabase = { from: (table) => { assert.equal(table, 'source_connections'); return query; } };
  const store = createSourceConnectionStore(supabase);

  const disabled = await store.disableSource('tg-container');
  assert.deepEqual(payload, { is_active: false, is_default: false });
  assert.deepEqual(filters, [['id', 'tg-container']]);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.isDefault, false);
});

test('getSourceById returns null when no Trading source exists', async () => {
  const query = {
    select() { return query; }, eq() { return query; },
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const store = createSourceConnectionStore({ from: () => query });
  assert.equal(await store.getSourceById('missing'), null);
});
