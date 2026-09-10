import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../db/migrations/0023_unified_trading_connections.sql');

test('migration 0023 adds only additive unified trading connection metadata', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE public\.trade_accounts[\s\S]*provider_mode TEXT/i);
  assert.match(sql, /environment TEXT/i);
  assert.match(sql, /roles JSONB/i);
  assert.match(sql, /provider_config JSONB/i);
  assert.match(sql, /UNIQUE[\s\S]*workspace_id[\s\S]*platform[\s\S]*provider_mode[\s\S]*account_id/i);
  assert.doesNotMatch(sql, /execution_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /is_active\s*=\s*true/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(sql, /GRANT\s+/i);
});
