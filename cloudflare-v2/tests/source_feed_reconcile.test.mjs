import test from 'node:test';
import assert from 'node:assert/strict';

import {
  desiredTelegramFeedIds,
  reconcileTelegramSourceFeeds,
} from '../src/sources/source_feed_reconcile.js';

function fakeSupabase(seed = []) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    from(table) {
      assert.equal(table, 'source_feeds');
      const state = { filters: [], inFilters: [], patch: null, operation: 'select' };
      const query = {
        upsert(incoming, options = {}) {
          assert.equal(options.onConflict, 'workspace_id,source_connection_id,provider_feed_id');
          for (const row of incoming) {
            const index = rows.findIndex((x) =>
              String(x.workspace_id) === String(row.workspace_id)
              && String(x.source_connection_id) === String(row.source_connection_id)
              && String(x.provider_feed_id) === String(row.provider_feed_id));
            if (index >= 0) rows[index] = { ...rows[index], ...row };
            else rows.push({ id: `feed-${rows.length + 1}`, ...row });
          }
          return Promise.resolve({ data: incoming, error: null });
        },
        select() { state.operation = 'select'; return query; },
        update(patch) { state.operation = 'update'; state.patch = patch; return query; },
        eq(field, value) { state.filters.push([field, value]); return query; },
        in(field, values) { state.inFilters.push([field, values.map(String)]); return query; },
        then(resolve, reject) {
          const matched = rows.filter((row) =>
            state.filters.every(([field, value]) => String(row[field]) === String(value))
            && state.inFilters.every(([field, values]) => values.includes(String(row[field]))));
          if (state.operation === 'update') matched.forEach((row) => Object.assign(row, state.patch));
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('desired Telegram feeds normalize the supported provider config shapes', () => {
  assert.deepEqual(desiredTelegramFeedIds('external_mtproto', {
    chat_acceptance_mode: 'allowlist',
    allowed_chat_ids: [' -1001 ', '-1001', '-1002'],
  }), ['-1001', '-1002']);
  assert.deepEqual(desiredTelegramFeedIds('telegram_bot_api', {
    allowed_chat_ids: ['-1003'],
  }), ['-1003']);
  assert.equal(desiredTelegramFeedIds('external_mtproto', {
    chat_acceptance_mode: 'all_visible',
  }), null);
});

test('reconciliation activates newly allowed chats and deactivates removed chats', async () => {
  const db = fakeSupabase([
    { id: 'old', workspace_id: 'ws-1', source_connection_id: 'src-1', provider_feed_id: '-1001', is_active: true },
    { id: 'removed', workspace_id: 'ws-1', source_connection_id: 'src-1', provider_feed_id: '-1009', is_active: true },
  ]);

  await reconcileTelegramSourceFeeds(db, 'ws-1', 'src-1', 'external_mtproto', {
    chat_acceptance_mode: 'allowlist',
    allowed_chat_ids: ['-1001', '-1002'],
  });

  assert.equal(db.rows.find((row) => row.provider_feed_id === '-1001').is_active, true);
  assert.equal(db.rows.find((row) => row.provider_feed_id === '-1002').is_active, true);
  assert.equal(db.rows.find((row) => row.provider_feed_id === '-1009').is_active, false);
});
