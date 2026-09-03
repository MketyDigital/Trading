import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ciPath = new URL('../../.github/workflows/trading-v1-ci.yml', import.meta.url);
const harnessPath = new URL('../scripts/gate2_queue_acceptance.mjs', import.meta.url);

const readCi = () => readFile(ciPath, 'utf8');
const readHarness = () => readFile(harnessPath, 'utf8');

test('Gate 2 acceptance is explicit marker-only, protected, and depends on tests', async () => {
  const workflow = await readCi();
  const start = workflow.indexOf('cloudflare-accept-gate2:');
  assert.ok(start >= 0, 'cloudflare-accept-gate2 job must exist');
  const block = workflow.slice(start);
  assert.match(block, /needs:\s*test/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /github\.event\.head_commit\.message == 'cloudflare: accept staging gate 2'/);
  assert.match(block, /secrets\.SUPABASE_SERVICE_ROLE/);
  assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
  assert.match(block, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*['"]false['"]/);
  assert.match(block, /TRADING_ACCESS_ENABLED:\s*['"]false['"]/);
});

test('Gate 2 acceptance avoids Container rollout, verifies zero instances, and always rolls back', async () => {
  const workflow = await readCi();
  const start = workflow.indexOf('cloudflare-accept-gate2:');
  const block = workflow.slice(start);
  assert.match(block, /--containers-rollout none/);
  assert.match(block, /gate2_queue_acceptance\.mjs/);
  assert.match(block, /wrangler containers list/);
  assert.match(block, /Ready.*0|ready.*0/i);
  assert.match(block, /wrangler rollback c25e85d5-bfe2-4d17-9ab4-5133d88ecec8/);
  assert.match(block, /always\(\).*acceptance_deploy\.outcome == 'success'/);
  assert.doesNotMatch(block, /BROKER_EXECUTION_ENABLED:\s*['"]true['"]/);
  assert.doesNotMatch(block, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*['"]true['"]/);
});

test('Gate 2 harness uses temporary external MTProto source, real queue handoff, persistent dedupe, and cleanup', async () => {
  const harness = await readHarness();
  assert.match(harness, /provider_type:\s*'external_mtproto'/);
  assert.match(harness, /\/api\/v1\/internal\/source-event/);
  assert.match(harness, /postInternalQueueEvent\(\);[\s\S]*postInternalQueueEvent\(\);/);
  assert.match(harness, /data\.length === 1/);
  assert.match(harness, /simulation\?\.executionEnabled === false/);
  assert.match(harness, /actions\.length === 3/);
  assert.match(harness, /cleanupFixture/);
  assert.doesNotMatch(harness, /cloudflare_container_mtproto/);
});
