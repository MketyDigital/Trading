import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../db/migrations/0007_trading_internal_privilege_hardening.sql', import.meta.url), 'utf8');

const internalTables = [
  'trading_workspace_access',
  'source_connections',
  'trading_events',
  'position_groups',
  'position_legs',
  'destination_deliveries',
  'trade_accounts',
];

test('hardening migration revokes client table privileges only from Trading-owned internal tables', () => {
  for (const table of internalTables) {
    assert.match(sql, new RegExp(`REVOKE\\s+ALL\\s+PRIVILEGES\\s+ON\\s+TABLE\\s+public\\.${table}\\s+FROM\\s+anon`, 'i'));
    assert.match(sql, new RegExp(`REVOKE\\s+ALL\\s+PRIVILEGES\\s+ON\\s+TABLE\\s+public\\.${table}\\s+FROM\\s+authenticated`, 'i'));
    assert.match(sql, new RegExp(`GRANT\\s+ALL\\s+PRIVILEGES\\s+ON\\s+TABLE\\s+public\\.${table}\\s+TO\\s+service_role`, 'i'));
  }

  assert.doesNotMatch(sql, /ON\s+(?:TABLE\s+)?public\.workspaces\b/i);
  assert.doesNotMatch(sql, /ON\s+(?:TABLE\s+)?public\.(?:users|campaigns|blogs|leads|chats|packages)\b/i);
});

test('hardening migration preserves RLS and creates no permissive client policies', () => {
  for (const table of internalTables) {
    assert.match(sql, new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'));
  }
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
});

test('default-source function is callable by service role only', () => {
  assert.match(sql, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+FUNCTION\s+public\.trading_set_default_source\s*\(uuid,\s*text,\s*uuid\)\s+FROM\s+PUBLIC/i);
  assert.match(sql, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+FUNCTION\s+public\.trading_set_default_source\s*\(uuid,\s*text,\s*uuid\)\s+FROM\s+anon/i);
  assert.match(sql, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+FUNCTION\s+public\.trading_set_default_source\s*\(uuid,\s*text,\s*uuid\)\s+FROM\s+authenticated/i);
  assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.trading_set_default_source\s*\(uuid,\s*text,\s*uuid\)\s+TO\s+service_role/i);
});
