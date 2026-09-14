import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, '../db/migrations/0031_connected_demo_execution_invariant.sql'), 'utf8');

test('demo invariant promotes only connected demo broker rows and never live execution', () => {
  assert.match(sql, /environment[^\n]*demo/i);
  assert.match(sql, /account_id[^\n]*NOT LIKE 'pending:%'/i);
  assert.match(sql, /provider_mode[^\n]*mt5_connector/i);
  assert.match(sql, /provider_config->>'status'[^\n]*connected/i);
  assert.match(sql, /roles[^\n]*execution/i);
  assert.match(sql, /NEW\.is_active\s*:=\s*true/i);
  assert.match(sql, /NEW\.execution_enabled\s*:=\s*true/i);
  assert.match(sql, /NEW\.live_execution_enabled\s*:=\s*false/i);
  assert.match(sql, /killSwitch[^\n]*false/i);
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.trade_accounts/i);
});
