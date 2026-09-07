import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/gate5-mtproto-soak.yml', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);
const runnerPath = new URL('../scripts/gate5_mtproto_soak.mjs', import.meta.url);
const triggerPath = new URL('../docs/GATE5_MTPROTO_SOAK_TRIGGER.md', import.meta.url);

async function readOptional(url) {
  try {
    return await readFile(url, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function jobBlock(workflow, name) {
  const start = workflow.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `${name} job must exist`);
  const tail = workflow.slice(start + 1);
  const nextJob = tail.match(/\n  [A-Za-z0-9_-]+:\n/);
  const end = nextJob ? start + 1 + nextJob.index : workflow.length;
  return workflow.slice(start, end);
}

test('Gate 5 MTProto soak workflow is exact-marker, staging-protected and broker-disabled', async () => {
  const workflow = await readOptional(workflowPath);
  assert.ok(workflow, 'Gate 5 protected workflow must exist');
  const block = jobBlock(workflow, 'mtproto-soak-gate5');

  assert.match(workflow.slice(0, workflow.indexOf('jobs:')), /cloudflare-v2\/docs\/GATE5_MTPROTO_SOAK_TRIGGER\.md/);
  assert.match(block, /needs:\s*test/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /github\.event_name == 'push'/);
  assert.match(block, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(block, /github\.event\.head_commit\.message == 'source: accept mtproto gate 5'/);
  assert.match(block, /TRADING_ACCESS_ENABLED:\s*['"]false['"]/);
  assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
  assert.match(block, /GATE5_CONTAINER_HEALTH_URL/);
  assert.match(block, /GATE5_DO_HEALTH_URL/);
  assert.match(block, /GATE5_EXTERNAL_HEALTH_URL/);
  assert.match(block, /GATE5_CONTAINER_EVENTS_URL/);
  assert.match(block, /GATE5_DO_EVENTS_URL/);
  assert.match(block, /GATE5_EXTERNAL_EVENTS_URL/);
  assert.match(block, /npm run accept:mtproto:gate5/);
  assert.doesNotMatch(block, /CTRADER_|MT5_|BROKER_.*true|TRADING_ACCESS_ENABLED:\s*['"]true['"]|wrangler\s+(?:deploy|publish)|executeTrade|placeOrder|marketOrder/i);
});

test('Gate 5 runner covers all providers, recovery, duplicate convergence, isolation and container guard without secret output', async () => {
  const runner = await readOptional(runnerPath);
  const trigger = await readOptional(triggerPath);
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));

  assert.ok(runner, 'Gate 5 runner must exist');
  assert.ok(trigger, 'Gate 5 trigger/runbook must exist');
  assert.equal(pkg.scripts['accept:mtproto:gate5'], 'node scripts/gate5_mtproto_soak.mjs');

  for (const provider of ['cloudflare_container_mtproto', 'cloudflare_do_mtproto', 'external_mtproto']) {
    assert.match(runner, new RegExp(provider));
  }
  assert.match(runner, /reconnect/i);
  assert.match(runner, /catch.?up/i);
  assert.match(runner, /duplicate/i);
  assert.match(runner, /cross.?provider/i);
  assert.match(runner, /container.?guard|container.?isolation/i);
  assert.match(runner, /downstream|isolation/i);
  assert.doesNotMatch(runner, /console\.log\([^\n]*(token|authorization|session|api_hash|phone)/i);
  assert.doesNotMatch(runner, /BROKER_EXECUTION_ENABLED\s*=\s*['"]?true/i);

  assert.match(trigger, /test Telegram account|dedicated test Telegram/i);
  assert.match(trigger, /restart|disconnect/i);
  assert.match(trigger, /edited/i);
  assert.match(trigger, /downstream failure/i);
  assert.match(trigger, /cross-provider/i);
  assert.match(trigger, /Container/i);
});

test('Gate 5 evidence evaluator fails closed unless all provider recovery and convergence proofs are present', async () => {
  const runner = await readOptional(runnerPath);
  assert.ok(runner, 'Gate 5 runner must exist before evaluator can be loaded');
  const { evaluateGate5AcceptanceEvidence } = await import('../scripts/gate5_mtproto_soak.mjs');

  const shared = 'sha256:shared-native-event';
  const complete = [
    {
      providerType: 'cloudflare_container_mtproto',
      sourceId: 'src-container',
      finalHealthy: true,
      reconnectCount: 1,
      catchUpCount: 1,
      duplicateCount: 1,
      canonicalEventDigests: [shared],
      downstreamIsolationObserved: true,
      containerTouched: true,
    },
    {
      providerType: 'cloudflare_do_mtproto',
      sourceId: 'src-do',
      finalHealthy: true,
      reconnectCount: 1,
      catchUpCount: 1,
      duplicateCount: 1,
      canonicalEventDigests: [shared],
      downstreamIsolationObserved: true,
      containerTouched: false,
    },
    {
      providerType: 'external_mtproto',
      sourceId: 'src-external',
      finalHealthy: true,
      reconnectCount: 1,
      catchUpCount: 1,
      duplicateCount: 1,
      canonicalEventDigests: [shared],
      downstreamIsolationObserved: true,
      containerTouched: false,
    },
  ];

  const accepted = evaluateGate5AcceptanceEvidence(complete);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.providerCount, 3);
  assert.equal(accepted.crossProviderDuplicateConvergence, true);
  assert.equal(accepted.containerIsolation, true);
  assert.equal(JSON.stringify(accepted).includes(shared), false);

  const unsafe = complete.map((item) => ({ ...item }));
  unsafe[1].containerTouched = true;
  const rejected = evaluateGate5AcceptanceEvidence(unsafe);
  assert.equal(rejected.ok, false);
  assert.match(rejected.reasons.join(' '), /container/i);

  const noRecovery = complete.map((item) => ({ ...item, reconnectCount: 0 }));
  const recoveryRejected = evaluateGate5AcceptanceEvidence(noRecovery);
  assert.equal(recoveryRejected.ok, false);
  assert.match(recoveryRejected.reasons.join(' '), /reconnect/i);
});
