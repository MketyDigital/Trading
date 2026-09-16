import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceFeedStore, providerFeedIdFromEvent } from '../src/sources/source_feed_store.js';

function query(result) {
  const state = { filters: [], upsertRows: null, selectFields: null };
  const api = {
    select(fields) { state.selectFields = fields; return api; },
    eq(field, value) { state.filters.push([field, value]); return api; },
    order() { return Promise.resolve(result); },
    maybeSingle() { return Promise.resolve(result); },
    upsert(rows) { state.upsertRows = rows; return api; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    state,
  };
  return api;
}

test('findActiveFeed scopes exact workspace connection and provider feed id', async () => {
  const q = query({ data: {
    id: 'feed-1', workspace_id: 'ws-1', source_connection_id: 'src-1', provider_feed_id: '-10011',
    display_name: 'Gold', feed_type: 'telegram_chat', is_active: true, metadata: {},
  }, error: null });
  const store = createSourceFeedStore({ from(name) { assert.equal(name, 'source_feeds'); return q; } });
  const feed = await store.findActiveFeed('ws-1', 'src-1', '-10011');
  assert.equal(feed.id, 'feed-1');
  assert.deepEqual(q.state.filters, [
    ['workspace_id', 'ws-1'], ['source_connection_id', 'src-1'], ['provider_feed_id', '-10011'], ['is_active', true],
  ]);
});

test('providerFeedIdFromEvent accepts persisted Telegram metadata naming variants', () => {
  assert.equal(providerFeedIdFromEvent({ metadata: { telegram_chat_id: -10011 } }), '-10011');
  assert.equal(providerFeedIdFromEvent({ metadata: { chatId: '-10022' } }), '-10022');
  assert.equal(providerFeedIdFromEvent({}), null);
});

test('upsertAllowedFeeds de-duplicates chat IDs and never invents another source connection', async () => {
  const q = query({ data: [], error: null });
  const store = createSourceFeedStore({ from(name) { assert.equal(name, 'source_feeds'); return q; } });
  await store.upsertAllowedFeeds('ws-1', 'one-userbot', ['-1001', '-1001', '-1002']);
  assert.deepEqual(q.state.upsertRows.map((row) => [row.source_connection_id, row.provider_feed_id]), [
    ['one-userbot', '-1001'], ['one-userbot', '-1002'],
  ]);
});
