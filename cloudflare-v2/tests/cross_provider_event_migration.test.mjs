import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/0004_cross_provider_event_identity.sql', import.meta.url);

test('migration adds provider-independent canonical event identity without replacing legacy idempotency', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /ALTER TABLE public\.trading_events[\s\S]*ADD COLUMN IF NOT EXISTS canonical_event_id TEXT/i);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS\s+\w+[\s\S]*ON public\.trading_events\s*\(workspace_id,\s*canonical_event_id\)[\s\S]*WHERE canonical_event_id IS NOT NULL/i,
  );

  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.workspaces/i);
  assert.doesNotMatch(sql, /DROP INDEX/i);
});
