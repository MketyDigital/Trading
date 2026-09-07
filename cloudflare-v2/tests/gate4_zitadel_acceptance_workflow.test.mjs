import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/gate4-zitadel-acceptance.yml', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);
const runnerPath = new URL('../scripts/gate4_zitadel_acceptance.mjs', import.meta.url);

async function readText(url) {
  return readFile(url, 'utf8');
}

function jobBlock(workflow, name) {
  const start = workflow.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `${name} job must exist`);
  const tail = workflow.slice(start + 1);
  const nextJob = tail.match(/\n  [A-Za-z0-9_-]+:\n/);
  const end = nextJob ? start + 1 + nextJob.index : workflow.length;
  return workflow.slice(start, end);
}

test('Gate 4 Zitadel acceptance is exact-marker, staging-protected and non-broker', async () => {
  const workflow = await readText(workflowPath);
  const block = jobBlock(workflow, 'zitadel-identity-gate4');

  assert.match(workflow.slice(0, workflow.indexOf('jobs:')), /cloudflare-v2\/docs\/GATE4_ZITADEL_ACCEPTANCE_TRIGGER\.md/);
  assert.match(block, /needs:\s*test/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /github\.event_name == 'push'/);
  assert.match(block, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(block, /github\.event\.head_commit\.message == 'identity: accept zitadel gate 4'/);
  assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
  assert.match(block, /TRADING_ACCESS_ENABLED:\s*['"]false['"]/);
  assert.match(block, /secrets\.GATE4_BASE_URL/);
  assert.match(block, /secrets\.GATE4_WORKSPACE_ID/);
  assert.match(block, /secrets\.GATE4_EXISTING_MKETY_TOKEN/);
  assert.match(block, /secrets\.GATE4_TRADING_ONLY_TOKEN/);
  assert.match(block, /secrets\.GATE4_WRONG_PROJECT_TOKEN/);
  assert.match(block, /secrets\.GATE4_WRONG_ORG_TOKEN/);
  assert.match(block, /npm run accept:zitadel:gate4/);
  assert.doesNotMatch(block, /CTRADER_|MT5_|BROKER_.*true|TRADING_ACCESS_ENABLED:\s*['"]true['"]|wrangler\s+(?:deploy|publish)|cloudflare[^\n]*(?:deploy|mutation|api)/i);
});

test('Gate 4 runner is secret-free and covers positive, negative, role and tenant isolation cases', async () => {
  const runner = await readText(runnerPath);
  const pkg = JSON.parse(await readText(packagePath));

  assert.equal(pkg.scripts['accept:zitadel:gate4'], 'node scripts/gate4_zitadel_acceptance.mjs');
  assert.match(runner, /existing[-_ ]Mkety/i);
  assert.match(runner, /Trading[-_ ]only/i);
  assert.match(runner, /wrong[-_ ]project/i);
  assert.match(runner, /wrong[-_ ]org/i);
  assert.match(runner, /missing[-_ ]membership/i);
  assert.match(runner, /disabled[-_ ]membership/i);
  assert.match(runner, /second[-_ ]tenant|tenant[-_ ]isolation/i);
  assert.match(runner, /owner/i);
  assert.match(runner, /admin/i);
  assert.match(runner, /operator/i);
  assert.match(runner, /viewer/i);
  assert.match(runner, /broker\.execute|broker execution/i);
  assert.match(runner, /TRADING_ACCESS_ENABLED/);
  assert.doesNotMatch(runner, /console\.log\([^\n]*(token|authorization|secret)/i);
  assert.doesNotMatch(runner, /BROKER_EXECUTION_ENABLED\s*=\s*['"]?true/i);
});
