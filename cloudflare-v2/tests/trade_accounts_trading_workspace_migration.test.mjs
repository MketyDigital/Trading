import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/0012_trade_accounts_trading_workspace_fk.sql', import.meta.url);
const sql = await readFile(migrationUrl, 'utf8');

test('trade-account tenancy migration aborts if existing Trading account workspace ids are not provisioned', () => {
  assert.match(sql, /FROM\s+public\.trade_accounts\s+ta/i);
  assert.match(sql, /LEFT\s+JOIN\s+public\.trading_workspace_access\s+twa\s+ON\s+twa\.id\s*=\s*ta\.workspace_id/i);
  assert.match(sql, /ta\.workspace_id\s+IS\s+NOT\s+NULL/i);
  assert.match(sql, /twa\.id\s+IS\s+NULL/i);
  assert.match(sql, /RAISE\s+EXCEPTION/i);
});

test('migration replaces only the legacy trade_accounts workspace foreign key with Trading-owned authority', () => {
  assert.match(sql, /pg_constraint/i);
  assert.match(sql, /trade_accounts/i);
  assert.match(sql, /workspaces/i);
  assert.match(sql, /DROP\s+CONSTRAINT/i);
  assert.match(sql, /FOREIGN\s+KEY\s*\(workspace_id\)\s+REFERENCES\s+public\.trading_workspace_access\s*\(id\)/i);
  assert.match(sql, /ON\s+DELETE\s+RESTRICT/i);
  assert.doesNotMatch(sql, /REFERENCES\s+public\.workspaces\s*\(id\)/i);
});

test('migration preserves account rows and never manufactures or mutates shared workspace state', () => {
  assert.doesNotMatch(sql, /ALTER\s+TABLE\s+public\.workspaces/i);
  assert.doesNotMatch(sql, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.workspaces/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.trading_workspace_access/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.trade_accounts/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+public\.trade_accounts/i);
  assert.doesNotMatch(sql, /DROP\s+TABLE/i);
});
