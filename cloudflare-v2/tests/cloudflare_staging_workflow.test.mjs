import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/cloudflare-staging-gate.yml', import.meta.url);

async function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

test('Cloudflare staging gate is manual-only and protected by the staging environment', async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*push:/);
  assert.doesNotMatch(workflow, /\n\s*pull_request:/);
  assert.match(workflow, /environment:\s*staging/);
});

test('Cloudflare staging gate uses GitHub environment secrets and never hard-codes credentials', async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN:\s*["']?[A-Za-z0-9_-]{20,}/);
});

test('Cloudflare staging gate defaults to inspect mode and requires explicit deployment selection', async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /mode:/);
  assert.match(workflow, /default:\s*inspect/);
  assert.match(workflow, /options:\s*\n(?:.|\n)*?- inspect\n(?:.|\n)*?- deploy-paid\n(?:.|\n)*?- deploy-free/);
  assert.match(workflow, /if:\s*\$\{\{ inputs\.mode == 'deploy-paid' \}\}/);
  assert.match(workflow, /if:\s*\$\{\{ inputs\.mode == 'deploy-free' \}\}/);
});

test('Cloudflare staging gate keeps TradingView ingress and broker execution disabled', async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*["']false["']/);
  assert.match(workflow, /TRADINGVIEW_CERT_PROBE_ENABLED:\s*["']false["']/);
  assert.match(workflow, /TRADING_ACCESS_ENABLED:\s*["']false["']/);
  assert.match(workflow, /BROKER_EXECUTION_ENABLED:\s*["']false["']/);
});

test('Cloudflare staging gate validates both Wrangler profiles before any deploy step', async () => {
  const workflow = await readWorkflow();
  const paidDryRun = workflow.indexOf('npx wrangler deploy --dry-run --config wrangler.toml');
  const freeDryRun = workflow.indexOf('npx wrangler deploy --dry-run --config wrangler.free.toml');
  const paidDeploy = workflow.indexOf('npx wrangler deploy --config wrangler.toml');
  const freeDeploy = workflow.indexOf('npx wrangler deploy --config wrangler.free.toml');

  assert.ok(paidDryRun >= 0, 'paid Wrangler dry-run must exist');
  assert.ok(freeDryRun >= 0, 'free Wrangler dry-run must exist');
  assert.ok(paidDeploy >= 0, 'paid deployment command must exist');
  assert.ok(freeDeploy >= 0, 'free deployment command must exist');
  assert.ok(paidDryRun < paidDeploy, 'paid dry-run must precede paid deployment');
  assert.ok(freeDryRun < freeDeploy, 'free dry-run must precede free deployment');
});
