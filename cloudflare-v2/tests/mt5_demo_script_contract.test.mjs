import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('package exposes explicit MT5 demo acceptance command backed by thin runner script', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts['accept:mt5:demo'], 'node scripts/mt5_demo_acceptance.mjs');

  const script = await readFile(new URL('scripts/mt5_demo_acceptance.mjs', root), 'utf8');
  assert.match(script, /runMT5DemoCommand/);
  assert.match(script, /process\.env/);
  assert.match(script, /process\.exitCode/);
  assert.doesNotMatch(script, /BRIDGE_SECRET\s*=|SERVICE_ROLE_KEY\s*=/);
});
