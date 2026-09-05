import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/0013_trading_workspace_hostnames.sql', import.meta.url);

test('0013 creates a service-role-only normalized custom-hostname mapping table', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /create table if not exists public\.trading_workspace_hostnames/i);
  assert.match(sql, /workspace_id\s+uuid\s+not null\s+references public\.trading_workspace_access\(id\)/i);
  assert.match(sql, /hostname\s+text\s+not null/i);
  assert.match(sql, /status\s+text\s+not null\s+default\s+'pending'/i);
  assert.match(sql, /status\s+in\s*\(\s*'pending'\s*,\s*'active'\s*,\s*'disabled'\s*\)/i);
  assert.match(sql, /unique\s*\(\s*hostname\s*\)/i);
  assert.match(sql, /hostname\s*=\s*lower\(hostname\)/i);
  assert.match(sql, /alter table public\.trading_workspace_hostnames enable row level security/i);
  assert.match(sql, /revoke all privileges on table public\.trading_workspace_hostnames from anon/i);
  assert.match(sql, /revoke all privileges on table public\.trading_workspace_hostnames from authenticated/i);
  assert.match(sql, /grant all privileges on table public\.trading_workspace_hostnames to service_role/i);
});
