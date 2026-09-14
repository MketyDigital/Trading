import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../db/migrations/0033_runtime_identity_upsert_constraints.sql', import.meta.url), 'utf8');

test('runtime identity uniqueness is a plain conflict target for Supabase upsert', () => {
  assert.match(sql, /CREATE UNIQUE INDEX idx_position_groups_workspace_runtime_group\s+ON public\.position_groups\(workspace_id, runtime_group_id\);/m);
  assert.match(sql, /CREATE UNIQUE INDEX idx_position_legs_group_runtime_leg\s+ON public\.position_legs\(position_group_id, runtime_leg_id\);/m);
  assert.doesNotMatch(sql, /WHERE\s+runtime_group_id\s+IS\s+NOT\s+NULL/i);
  assert.doesNotMatch(sql, /WHERE\s+runtime_leg_id\s+IS\s+NOT\s+NULL/i);
});
