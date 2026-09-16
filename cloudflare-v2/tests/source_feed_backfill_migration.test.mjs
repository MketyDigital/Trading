import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('source-feed backfill migration materializes persisted Telegram allowlists idempotently', async () => {
  const sql = await readFile(new URL('../db/migrations/0038_backfill_telegram_source_feeds.sql', import.meta.url), 'utf8');
  assert.match(sql, /INSERT\s+INTO\s+public\.source_feeds/i);
  assert.match(sql, /public\.source_connections/i);
  assert.match(sql, /allowed_chat_ids/i);
  assert.match(sql, /chat_ids/i);
  assert.match(sql, /external_mtproto/i);
  assert.match(sql, /telegram_bot_api/i);
  assert.match(sql, /cloudflare_container_mtproto/i);
  assert.match(sql, /cloudflare_do_mtproto/i);
  assert.match(sql, /ON\s+CONFLICT\s*\(workspace_id,\s*source_connection_id,\s*provider_feed_id\)/i);
  assert.match(sql, /is_active\s*=\s*true/i);
});
