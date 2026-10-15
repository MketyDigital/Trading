import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/0049_orphan_signal_recovery_cursor.sql', import.meta.url);

test('orphan recovery cursor is durable and service-role-only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.orphan_signal_recovery_cursors/i);
  assert.match(sql, /last_received_at TIMESTAMPTZ/i);
  assert.match(sql, /last_event_id UUID/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES[\s\S]*FROM anon, authenticated/i);
  assert.match(sql, /GRANT ALL PRIVILEGES[\s\S]*TO service_role/i);
});
