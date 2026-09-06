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

test('Gate 2 acceptance avoids Container rollout, compares concrete instance state, and always rolls back', async () => {
  const workflow = await readCi();
  const start = workflow.indexOf('cloudflare-accept-gate2:');
  const block = workflow.slice(start);
  assert.match(block, /--containers-rollout none/);
  assert.match(block, /gate2_queue_acceptance\.mjs/);
  assert.match(block, /wrangler containers instances/);
  assert.match(block, /gate2-containers-before\.json/);
  assert.match(block, /gate2-containers-after\.json/);
  assert.match(block, /wrangler rollback c25e85d5-bfe2-4d17-9ab4-5133d88ecec8/);
  assert.match(block, /always\(\).*acceptance_deploy\.outcome == 'success'/);
  assert.doesNotMatch(block, /BROKER_EXECUTION_ENABLED:\s*['"]true['"]/);
  assert.doesNotMatch(block, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*['"]true['"]/);
});

test('Gate 2 waits for the newly deployed internal transport token before queue acceptance', async () => {
  const workflow = await readCi();
  const start = workflow.indexOf('cloudflare-accept-gate2:');
  const block = workflow.slice(start);
  const deploy = block.indexOf('Deploy temporary simulation-enabled Worker version without Container rollout');
  const readiness = block.indexOf('Wait for deployed internal transport secret to become active');
  const acceptance = block.indexOf('Exercise real Queue path, deduplication, and non-broker simulation');
  assert.ok(deploy >= 0, 'acceptance deploy step must exist');
  assert.ok(readiness > deploy, 'secret-readiness probe must follow deploy');
  assert.ok(acceptance > readiness, 'real queue acceptance must follow secret-readiness probe');
  assert.match(block, /INVALID_SOURCE_EVENT/);
  assert.match(block, /400/);
  assert.match(block, /401/);
  assert.match(block, /x-mkety-internal-source-token/i);
});

test('Gate 2 temporary external MTProto source explicitly authorizes only its synthetic chat', async () => {
  const harness = await readHarness();
  assert.match(harness, /provider_type:\s*'external_mtproto'/);
  assert.match(harness, /chat_acceptance_mode:\s*'allowlist'/);
  assert.match(harness, /allowed_chat_ids:\s*\[\s*'-1000000000001'\s*\]/);
});

test('Gate 2 external signed event proves Trading access remains fail-closed', async () => {
  const harness = await readHarness();
  const probeStart = harness.indexOf('async function proveExternalTradingAccessFailsClosed()');
  assert.ok(probeStart >= 0, 'fail-closed external access probe must exist');
  const probeBlock = harness.slice(probeStart, harness.indexOf('async function verifyQueueDeduplication()', probeStart));
  assert.match(probeBlock, /buildSignedV1Request/);
  assert.match(probeBlock, /native_identity/);
  assert.match(probeBlock, /chat_id:\s*'-1000000000001'/);
  assert.match(probeBlock, /message_id:\s*'2'/);
  assert.match(probeBlock, /response\.status === 503/);
  assert.match(probeBlock, /TRADING_ACCESS_DISABLED/);
});

test('Gate 2 harness uses real queue handoff, persistent dedupe, zero broker delivery, and cleanup', async () => {
  const harness = await readHarness();
  assert.match(harness, /\/api\/v1\/internal\/source-event/);
  assert.match(harness, /postInternalQueueEvent\(\);[\s\S]*postInternalQueueEvent\(\);/);
  assert.match(harness, /data\.length === 1/);
  assert.match(harness, /processing_status.*READY|processingStatus:\s*'READY'/);
  assert.match(harness, /destination_deliveries/);
  assert.match(harness, /data\.length === 0/);
  assert.match(harness, /brokerExecution:\s*false/);
  assert.match(harness, /cleanupFixture/);
  assert.doesNotMatch(harness, /cloudflare_container_mtproto/);
});