import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../db/migrations/0014_trading_connection_credentials.sql');

test('migration 0014 adds broker credential ciphertext storage only to Trading trade_accounts', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /ALTER TABLE public\.trade_accounts[\s\S]*ADD COLUMN IF NOT EXISTS credential_ciphertext TEXT/i);
  assert.match(sql, /COMMENT ON COLUMN public\.trade_accounts\.credential_ciphertext[\s\S]*(decrypt server-side|server-side decrypt)/i);
  assert.match(sql, /never expose/i);

  assert.doesNotMatch(sql, /GRANT\s+/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.workspaces/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.users/i);
});
