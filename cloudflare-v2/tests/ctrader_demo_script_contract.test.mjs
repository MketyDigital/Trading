import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('package exposes explicit cTrader demo acceptance command backed by thin runner script', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.scripts['accept:ctrader:demo'], 'node scripts/ctrader_demo_acceptance.mjs');

  const script = await readFile(new URL('scripts/ctrader_demo_acceptance.mjs', root), 'utf8');
  assert.match(script, /runCTraderDemoCommand/);
  assert.match(script, /process\.env/);
  assert.match(script, /process\.exitCode/);
  assert.doesNotMatch(script, /CLIENT_SECRET\s*=|ACCESS_TOKEN\s*=|SERVICE_ROLE_KEY\s*=/);
});
