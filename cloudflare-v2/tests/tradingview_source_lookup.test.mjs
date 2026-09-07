import test from 'node:test';
import assert from 'node:assert/strict';

import { createSourceConnectionStore } from '../src/sources/source_connection_store.js';

function makeQuery(rows, observed) {
  const filters = [];
  const query = {
    select(columns) { observed.select = columns; return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    maybeSingle: async () => {
      observed.filters = [...filters];
      let data = rows;
      for (const [column, value] of filters) data = data.filter((row) => row[column] === value);
      return { data: data[0] ?? null, error: null };
    },
  };
  return query;
}

test('resolves one exact active TradingView webhook source by non-secret public handle', async () => {
  const observed = {};
  const rows = [{
    id: 'tv-a', workspace_id: 'ws-a', source_type: 'tradingview', source_instance_id: 'tv-a',
    source_family: 'tradingview', provider_type: 'tradingview_webhook', public_source_handle: 'tv_public_abc',
    external_identity: 'account-a', is_active: true, is_default: true, priority: 10, config: {},
  }];
  const store = createSourceConnectionStore({ from: () => makeQuery(rows, observed) });

  const source = await store.getActiveTradingViewSourceByPublicHandle('tv_public_abc');

  assert.equal(source.id, 'tv-a');
  assert.equal(source.workspaceId, 'ws-a');
  assert.equal(source.sourceFamily, 'tradingview');
  assert.equal(source.providerType, 'tradingview_webhook');
  assert.equal(source.publicSourceHandle, 'tv_public_abc');
  assert.deepEqual(observed.filters, [
    ['public_source_handle', 'tv_public_abc'],
    ['is_active', true],
    ['provider_type', 'tradingview_webhook'],
    ['source_family', 'tradingview'],
  ]);
  assert.match(observed.select, /public_source_handle/);
  assert.doesNotMatch(observed.select, /secret_ciphertext|secret|token|password/i);
});

test('TradingView public handle lookup fails closed for missing, inactive, wrong-family and wrong-provider sources', async () => {
  const cases = [
    [],
    [{ id: 'tv-a', public_source_handle: 'tv_public_abc', is_active: false, source_family: 'tradingview', provider_type: 'tradingview_webhook' }],
    [{ id: 'tv-a', public_source_handle: 'tv_public_abc', is_active: true, source_family: 'telegram', provider_type: 'tradingview_webhook' }],
    [{ id: 'tv-a', public_source_handle: 'tv_public_abc', is_active: true, source_family: 'tradingview', provider_type: 'custom_signed_api' }],
  ];

  for (const rows of cases) {
    const store = createSourceConnectionStore({ from: () => makeQuery(rows, {}) });
    assert.equal(await store.getActiveTradingViewSourceByPublicHandle('tv_public_abc'), null);
  }
  const store = createSourceConnectionStore({ from: () => makeQuery([], {}) });
  assert.equal(await store.getActiveTradingViewSourceByPublicHandle(''), null);
});
