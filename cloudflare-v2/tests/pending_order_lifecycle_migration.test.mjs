import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../db/migrations/0048_pending_order_lifecycle_state.sql', import.meta.url), 'utf8');

test('pending order lifecycle migration is additive and leaves existing leg rows valid', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS parent_leg_id TEXT/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS lifecycle_role TEXT/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS lifecycle_tracking_enabled BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS originating_order_id TEXT/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS logical_target_index INTEGER/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_broker_observed_at TIMESTAMPTZ/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_broker_source_version TEXT/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_broker_status TEXT/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_broker_snapshot_fingerprint TEXT/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS broker_deal_ids JSONB NOT NULL DEFAULT '\[\]'::jsonb/i);
  assert.match(migration, /WHERE status = 'PENDING'[\s\S]*broker_order_id IS NOT NULL/i);
  assert.doesNotMatch(migration, /DROP\s+(?:COLUMN|CONSTRAINT|INDEX)\b/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.position_legs\b/i);
});
