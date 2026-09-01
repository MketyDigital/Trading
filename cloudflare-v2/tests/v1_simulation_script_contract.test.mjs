import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('package exposes explicit signed V1 simulation acceptance command backed by thin runner script', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts['accept:v1:simulation'], 'node scripts/v1_simulation_acceptance.mjs');

  const script = await readFile(new URL('scripts/v1_simulation_acceptance.mjs', root), 'utf8');
  assert.match(script, /runV1SimulationAcceptanceCommand/);
  assert.match(script, /process\.env/);
  assert.match(script, /process\.exitCode/);
  assert.doesNotMatch(script, /SOURCE_SECRET\s*=|SUPABASE_SERVICE_ROLE_KEY\s*=/);
});
