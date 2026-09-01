import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../db/migrations/0002_trade_correlation_and_account_policy.sql', import.meta.url), 'utf8');

test('migration persists source/thread correlation identity on position groups', () => {
  assert.match(sql, /source_instance_id\s+TEXT/i);
  assert.match(sql, /source_event_ids\s+TEXT\[\]/i);
  assert.match(sql, /thread_id\s+TEXT/i);
  assert.match(sql, /incomplete\s+BOOLEAN/i);
  assert.match(sql, /position_mode\s+TEXT/i);
});

test('migration adds explicit account execution gate and safety policy configuration', () => {
  assert.match(sql, /ALTER TABLE public\.trade_accounts/i);
  assert.match(sql, /execution_enabled\s+BOOLEAN/i);
  assert.match(sql, /safety_policy\s+JSONB/i);
  assert.match(sql, /fast_entry_policy\s+TEXT/i);
  assert.match(sql, /entry_zone_policy\s+TEXT/i);
});

test('migration indexes active source correlation scans', () => {
  assert.match(sql, /position_groups.*source_instance_id.*status/is);
});
