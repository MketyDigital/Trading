import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../db/migrations/0005_mtproto_provider_credentials.sql', import.meta.url);

test('migration adds a separate encrypted provider credential envelope without weakening shared schema', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(
    sql,
    /ALTER TABLE public\.source_connections[\s\S]*ADD COLUMN IF NOT EXISTS provider_secret_ciphertext TEXT/i,
  );
  assert.match(
    sql,
    /COMMENT ON COLUMN public\.source_connections\.provider_secret_ciphertext[\s\S]*provider-specific encrypted credential/i,
  );
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.workspaces/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.source_connections[\s\S]*secret_ciphertext\s*=/i);
});
