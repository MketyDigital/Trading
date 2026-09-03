import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/gate6-demo-probes.yml', import.meta.url);

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

test('Gate 6 MT5 demo probe is exact-marker, staging-protected, probe-only and non-executing', async () => {
  const workflow = await readWorkflow();
  const block = jobBlock(workflow, 'mt5-demo-probe-gate6');
  assert.match(workflow.slice(0, workflow.indexOf('jobs:')), /cloudflare-v2\/docs\/GATE6_DEMO_PROBE_TRIGGER\.md/);
  assert.match(block, /needs:\s*test/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /github\.event_name == 'push'/);
  assert.match(block, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(block, /github\.event\.head_commit\.message == 'demo: probe mt5 gate 6'/);
  assert.match(block, /MT5_DEMO_ACCEPTANCE_MODE:\s*['"]probe['"]/);
  assert.match(block, /MT5_DEMO_ORDER_TEST:\s*['"]false['"]/);
  assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
  assert.match(block, /secrets\.MT5_BRIDGE_URL/);
  assert.match(block, /secrets\.MT5_BRIDGE_SECRET/);
  assert.match(block, /secrets\.MT5_ACCOUNT_ID/);
  assert.match(block, /MT5_DEMO_SERVER:\s*\$\{\{\s*secrets\.MT5_EXPECTED_DEMO_SERVER\s*\}\}/);
  assert.match(block, /npm run accept:mt5:demo/);
  assert.doesNotMatch(block, /SUPABASE_|TRADING_WORKSPACE_ID|\bwrangler\b|CLOUDFLARE_|lifecycle/i);
});

test('Gate 6 cTrader demo probe is exact-marker, staging-protected, demo-only and fail-closed', async () => {
  const workflow = await readWorkflow();
  const block = jobBlock(workflow, 'ctrader-demo-probe-gate6');
  assert.match(block, /needs:\s*test/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /github\.event_name == 'push'/);
  assert.match(block, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(block, /github\.event\.head_commit\.message == 'demo: probe ctrader gate 6'/);
  assert.match(block, /CTRADER_DEMO_ACCEPTANCE_MODE:\s*['"]probe['"]/);
  assert.match(block, /CTRADER_DEMO_ORDER_TEST:\s*['"]false['"]/);
  assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
  assert.match(block, /secrets\.CTRADER_CLIENT_ID/);
  assert.match(block, /secrets\.CTRADER_CLIENT_SECRET/);
  assert.match(block, /secrets\.CTRADER_ACCESS_TOKEN/);
  assert.match(block, /secrets\.CTRADER_ACCOUNT_ID/);
  assert.match(block, /npm run accept:ctrader:demo/);
  assert.doesNotMatch(block, /SUPABASE_|TRADING_WORKSPACE_ID|\bwrangler\b|CLOUDFLARE_|lifecycle|allowLiveTrading:\s*true/i);
});
