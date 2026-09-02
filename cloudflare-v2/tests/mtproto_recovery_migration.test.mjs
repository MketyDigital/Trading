import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/0006_mtproto_recovery_state.sql', import.meta.url);

test('migration adds only Trading-owned durable MTProto recovery state', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /ALTER TABLE public\.source_connections[\s\S]*ADD COLUMN IF NOT EXISTS recovery_attempt_count INTEGER NOT NULL DEFAULT 0/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS recovery_next_attempt_at TIMESTAMPTZ/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_recovery_at TIMESTAMPTZ/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_recovery_error_code TEXT/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS\s+\w+[\s\S]*source_connections[\s\S]*provider_type[\s\S]*is_active/i);

  assert.doesNotMatch(sql, /ALTER TABLE public\.workspaces/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
});
