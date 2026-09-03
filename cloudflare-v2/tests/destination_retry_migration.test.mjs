import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/0011_destination_delivery_retry_state.sql', import.meta.url);

test('destination retry migration is additive, indexed, and preserves workspace idempotency authority', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /ALTER TABLE public\.destination_deliveries[\s\S]*ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS failure_class TEXT/i);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS\s+\w+[\s\S]*ON public\.destination_deliveries[\s\S]*status[\s\S]*next_attempt_at/i);

  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.workspaces/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.trading_workspace_access/i);
  assert.doesNotMatch(sql, /DROP CONSTRAINT[\s\S]*idempotency/i);
  assert.doesNotMatch(sql, /UNIQUE\s*\(\s*idempotency_key\s*\)/i);
});
