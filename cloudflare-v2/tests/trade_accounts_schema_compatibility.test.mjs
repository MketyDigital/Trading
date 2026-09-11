import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbRoot = path.resolve(here, '..', 'db');

test('new provider-mode trade accounts do not require legacy api_token_encrypted', () => {
  const schema = fs.readFileSync(path.join(dbRoot, 'schema.sql'), 'utf8');
  assert.match(schema, /api_token_encrypted\s+TEXT(?!\s+NOT\s+NULL)/i);

  const migration = fs.readFileSync(path.join(dbRoot, 'migrations', '0026_trade_accounts_legacy_token_nullable.sql'), 'utf8');
  assert.match(migration, /alter\s+table\s+public\.trade_accounts\s+alter\s+column\s+api_token_encrypted\s+drop\s+not\s+null/i);
});
