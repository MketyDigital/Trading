import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production deploy snapshots and verifies all database-owned runtime switches without mutating them', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/production-cloudflare-deploy.yml', import.meta.url), 'utf8');

  assert.match(workflow, /Snapshot persisted runtime controls before deployment/);
  assert.match(workflow, /Verify persisted owner broker switch without changing it/);
  for (const key of ['tradingAccessEnabled', 'brokerExecutionEnabled', 'liveBrokerExecutionEnabled']) {
    assert.ok(workflow.includes(key), `deployment must preserve ${key}`);
  }
  assert.match(workflow, /deployment changed persisted \$\{key\}/);
  assert.match(workflow, /persisted runtime control timestamp changed/);
  assert.match(workflow, /runtime-controls-before\.json/);

  // Production config may retain a defensive environment setting, but it must
  // not rewrite or derive the persisted admin switches from deployment vars.
  assert.doesNotMatch(workflow, /curl[^\n]*-X\s+PATCH[^\n]*runtime-controls/i);
  assert.doesNotMatch(workflow, /set(BrokerExecution|LiveBrokerExecution|TradingAccess)Enabled/);
});
