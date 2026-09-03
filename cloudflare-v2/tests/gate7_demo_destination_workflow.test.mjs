import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/gate7-demo-destinations.yml', import.meta.url);

async function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

function jobBlock(workflow, name) {
  const start = workflow.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `${name} job must exist`);
  const tail = workflow.slice(start + 1);
  const nextJob = tail.match(/\n  [A-Za-z0-9_-]+:\n/);
  const end = nextJob ? start + 1 + nextJob.index : workflow.length;
  return workflow.slice(start, end);
}

function assertCommonLifecycleSafety(block, marker) {
  assert.match(block, /needs:\s*test/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /github\.event_name == 'push'/);
  assert.match(block, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(block, new RegExp(`github\\.event\\.head_commit\\.message == '${marker}'`));
  assert.match(block, /SUPABASE_URL:\s*\$\{\{\s*secrets\.SUPABASE_URL\s*\}\}/);
  assert.match(block, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_SERVICE_ROLE_KEY\s*\}\}/);
  assert.match(block, /TRADING_WORKSPACE_ID:\s*\$\{\{\s*secrets\.TRADING_WORKSPACE_ID\s*\}\}/);
  assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
  assert.doesNotMatch(block, /\bwrangler\b|CLOUDFLARE_|allowLiveTrading:\s*true/i);
}

test('Gate 7 MT5 destination lifecycle is exact-marker, protected, persistent and demo-only', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow.slice(0, workflow.indexOf('jobs:')), /cloudflare-v2\/docs\/GATE7_DEMO_DESTINATION_TRIGGER\.md/);
  const block = jobBlock(workflow, 'mt5-demo-lifecycle-gate7');
  assertCommonLifecycleSafety(block, 'demo: lifecycle mt5 gate 7');
  assert.match(block, /MT5_DEMO_ACCEPTANCE_MODE:\s*['"]lifecycle['"]/);
  assert.match(block, /MT5_DEMO_ORDER_TEST:\s*['"]true['"]/);
  assert.match(block, /MT5_DEMO_SERVER:\s*\$\{\{\s*secrets\.MT5_EXPECTED_DEMO_SERVER\s*\}\}/);
  assert.match(block, /MT5_DEMO_TEST_LOTS:\s*\$\{\{\s*vars\.MT5_DEMO_TEST_LOTS\s*\|\|\s*'0\.01'\s*\}\}/);
  assert.match(block, /npm run accept:mt5:demo/);
});

test('Gate 7 cTrader destination lifecycle is exact-marker, protected, persistent and demo-only', async () => {
  const workflow = await readWorkflow();
  const block = jobBlock(workflow, 'ctrader-demo-lifecycle-gate7');
  assertCommonLifecycleSafety(block, 'demo: lifecycle ctrader gate 7');
  assert.match(block, /CTRADER_DEMO_ACCEPTANCE_MODE:\s*['"]lifecycle['"]/);
  assert.match(block, /CTRADER_DEMO_ORDER_TEST:\s*['"]true['"]/);
  assert.match(block, /CTRADER_DEMO_TEST_LOTS:\s*\$\{\{\s*vars\.CTRADER_DEMO_TEST_LOTS\s*\|\|\s*'0\.01'\s*\}\}/);
  assert.match(block, /npm run accept:ctrader:demo/);
});
