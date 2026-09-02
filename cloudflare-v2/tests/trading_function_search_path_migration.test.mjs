import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../db/migrations/0008_trading_default_source_search_path.sql', import.meta.url), 'utf8');

test('default-source RPC pins an empty search_path without widening its privileges', () => {
  assert.match(
    sql,
    /ALTER\s+FUNCTION\s+public\.trading_set_default_source\s*\(uuid,\s*text,\s*uuid\)\s+SET\s+search_path\s*=\s*''/i,
  );
  assert.doesNotMatch(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION[\s\S]*\b(?:PUBLIC|anon|authenticated)\b/i);
  assert.doesNotMatch(sql, /ALTER\s+(?:TABLE|DEFAULT\s+PRIVILEGES)|CREATE\s+POLICY|SECURITY\s+DEFINER/i);
});
