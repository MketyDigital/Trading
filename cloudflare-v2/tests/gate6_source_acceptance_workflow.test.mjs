import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/gate6-source-acceptance.yml', import.meta.url);
const triggerPath = new URL('../docs/GATE6_SOURCE_ACCEPTANCE_TRIGGER.md', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);
const ctraderRunnerPath = new URL('../scripts/gate6_ctrader_source_acceptance.mjs', import.meta.url);
const mt5RunnerPath = new URL('../bridges/mt5_source_acceptance.py', import.meta.url);

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

test('Gate 6 real source acceptance is marker-only, staging-protected and broker-execution disabled', async () => {
  const workflow = await readText(workflowPath);
  const mt5 = jobBlock(workflow, 'mt5-source-gate6');
  const ctrader = jobBlock(workflow, 'ctrader-source-gate6');

  assert.match(workflow.slice(0, workflow.indexOf('jobs:')), /cloudflare-v2\/docs\/GATE6_SOURCE_ACCEPTANCE_TRIGGER\.md/);
  for (const block of [mt5, ctrader]) {
    assert.match(block, /needs:\s*test/);
    assert.match(block, /environment:\s*staging/);
    assert.match(block, /github\.event_name == 'push'/);
    assert.match(block, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
    assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
    assert.doesNotMatch(block, /DEMO_ORDER_TEST:\s*['"]true['"]|ACCEPTANCE_MODE:\s*['"]lifecycle['"]|buildTestAction|OPEN_POSITION|wrangler\s+(?:deploy|publish)/i);
  }

  assert.match(mt5, /github\.event\.head_commit\.message == 'source: accept mt5 gate 6'/);
  assert.match(mt5, /python\s+bridges\/mt5_source_acceptance\.py/);
  assert.match(ctrader, /github\.event\.head_commit\.message == 'source: accept ctrader gate 6'/);
  assert.match(ctrader, /npm run accept:ctrader:source:gate6/);
});

test('Gate 6 source runners exercise capture-to-canonical replay without creating broker orders', async () => {
  const [mt5, ctrader, pkg, trigger] = await Promise.all([
    readText(mt5RunnerPath),
    readText(ctraderRunnerPath),
    readText(packagePath).then(JSON.parse),
    readText(triggerPath),
  ]);

  assert.equal(pkg.scripts['accept:ctrader:source:gate6'], 'node scripts/gate6_ctrader_source_acceptance.mjs');

  assert.match(mt5, /MT5SourceCapture/);
  assert.match(mt5, /MT5SourceDelivery/);
  assert.match(mt5, /overlap|replay/i);
  assert.match(mt5, /history_deals_get|poll_once/);
  assert.match(mt5, /duplicate|delivered/i);
  assert.match(mt5, /source[_-]?id/i);
  assert.doesNotMatch(mt5, /order_send|OPEN_POSITION|buildTestAction|DEMO_ORDER_TEST/i);

  assert.match(ctrader, /CTraderSourceCapture/);
  assert.match(ctrader, /createSignedSourceDelivery|SignedSource|source delivery/i);
  assert.match(ctrader, /reconnect|replay/i);
  assert.match(ctrader, /duplicate|canonical/i);
  assert.match(ctrader, /ctidTraderAccountId|accountId/);
  assert.doesNotMatch(ctrader, /buildTestAction|OPEN_POSITION|lifecycle|DEMO_ORDER_TEST/i);

  assert.match(trigger, /### MT5 source/i);
  assert.match(trigger, /history_deals_get|broker deal history/i);
  assert.match(trigger, /cTrader.*deal event/i);
  assert.match(trigger, /canonical/i);
  assert.match(trigger, /replay/i);
  assert.match(trigger, /no.*broker.*order|must not.*order/i);
});
