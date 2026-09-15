import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('access-code reissue migration performs rotation in one service-role-only database function', async () => {
  const sql = await readFile(new URL('../db/migrations/0034_atomic_access_code_rotation.sql', import.meta.url), 'utf8');

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rotate_trading_access_code/i);
  assert.match(sql, /SELECT \*[\s\S]*FROM public\.trading_workspace_access[\s\S]*FOR UPDATE/i);
  assert.match(sql, /INSERT INTO public\.trading_access_codes/i);
  assert.match(sql, /UPDATE public\.trading_access_codes[\s\S]*status = 'revoked'/i);
  assert.match(sql, /UPDATE public\.trading_workspace_access/i);
  assert.match(sql, /'accessCodeId', v_created\.id/i);
  assert.match(sql, /SECURITY DEFINER/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.rotate_trading_access_code[\s\S]*FROM anon/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.rotate_trading_access_code[\s\S]*FROM authenticated/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.rotate_trading_access_code[\s\S]*TO service_role/i);
});
