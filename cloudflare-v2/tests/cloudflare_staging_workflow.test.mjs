import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/cloudflare-staging-gate.yml', import.meta.url);
const ciWorkflowPath = new URL('../../.github/workflows/trading-v1-ci.yml', import.meta.url);
const stagingConfigPath = new URL('../wrangler.trading-staging.toml', import.meta.url);

async function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

async function readCiWorkflow() {
  return readFile(ciWorkflowPath, 'utf8');
}

test('Trading storage PR provisions and migrates only the isolated staging D1', async () => {
  const workflow = await readCiWorkflow();
  const start = workflow.indexOf('  cloudflare-storage-inventory:');
  const end = workflow.indexOf('\n  cloudflare-inspect:', start);
  assert.ok(start >= 0, 'cloudflare-storage-inventory job must exist');
  assert.ok(end > start, 'storage inventory job must end before the existing inspection job');
  const block = workflow.slice(start, end);

  assert.match(block, /github\.event_name == 'pull_request'/);
  assert.match(block, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(block, /github\.event\.pull_request\.head\.ref == 'feat\/trading-d1-cutover-implementation'/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /permissions:\s*\n\s+contents:\s*read/);
  assert.match(block, /npm ci[^\n]*\n/);
  assert.match(block, /npx wrangler whoami/);
  assert.match(block, /npx wrangler d1 list --json > "\$RUNNER_TEMP\/trading-d1-inventory\.json"/);
  assert.match(block, /node --input-type=module <<'D1_INVENTORY'/);
  assert.match(block, /npx wrangler d1 create trading-staging/);
  assert.match(block, /database_name = "trading-staging"/);
  assert.match(block, /migrations_dir = "db\/d1-migrations"/);
  assert.match(block, /npx wrangler d1 migrations apply trading-staging --remote --config wrangler\.trading-staging\.toml/);
  assert.match(block, /npx wrangler d1 migrations list trading-staging --remote --config wrangler\.trading-staging\.toml/);
  assert.match(block, /Check for a dedicated Trading PostgreSQL staging secret/);
  assert.match(block, /TRADING_PG_STAGING_DATABASE_URL: \$\{\{ secrets\.TRADING_PG_STAGING_DATABASE_URL \}\}/);
  assert.match(block, /Dedicated Trading PostgreSQL staging credential is configured/);
  assert.match(block, /Dedicated Trading PostgreSQL staging credential is not configured/);
  assert.match(block, /generic staging database credential is configured; it is not approved for Trading use/);
  assert.doesNotMatch(block, /echo [^\n]*\$\{(?:TRADING_PG_STAGING_DATABASE_URL|STAGING_DATABASE_URL)/);
  assert.match(block, /npx wrangler hyperdrive list > "\$RUNNER_TEMP\/trading-hyperdrive-inventory\.txt"/);
  assert.match(block, /Hyperdrive inventory completed; resource details withheld from CI logs/);
  assert.doesNotMatch(block, /npx wrangler hyperdrive list\s*\n/);
  assert.doesNotMatch(block, /cat\s+"?\$RUNNER_TEMP\/trading-hyperdrive-inventory\.txt/);
  assert.doesNotMatch(block, /console\.log\([^\n]*(?:host|hostname|user|username|password|connection string)/i);
  assert.doesNotMatch(block, /wrangler\s+(?:deploy|delete|update)/);
  assert.doesNotMatch(block, /npx wrangler d1 create (?!trading-staging)[^\s]+/);

  const installAt = block.indexOf('npm ci');
  const credentialsAt = block.indexOf('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
  assert.ok(installAt >= 0, 'dependencies must be installed');
  assert.ok(credentialsAt > installAt, 'Cloudflare credentials must be scoped only after dependency installation');
  assert.doesNotMatch(block.slice(0, credentialsAt), /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
});

test('Trading D1 staging Worker config remains private, fenced and broker-disabled', async () => {
  const config = await readFile(stagingConfigPath, 'utf8');
  assert.match(config, /^name = "mkety-trading-storage-staging"$/m);
  assert.match(config, /^workers_dev = false$/m);
  assert.match(config, /^preview_urls = false$/m);
  assert.match(config, /^binding = "DB"$/m);
  assert.match(config, /^database_name = "trading-staging"$/m);
  assert.match(config, /^database_id = "4f00d59a-3d90-4146-832d-36230d5648bb"$/m);
  assert.match(config, /^TRADING_STORAGE_RUNTIME_ENABLED = "true"$/m);
  assert.match(config, /^TRADING_STORAGE_AUTHORITY = "d1"$/m);
  assert.match(config, /^TRADING_STORAGE_AUTHORITY_EPOCH = "1"$/m);
  for (const setting of [
    'TRADING_ACCESS_ENABLED',
    'BROKER_EXECUTION_ENABLED',
    'LIVE_BROKER_EXECUTION_ENABLED',
    'TRADINGVIEW_DIRECT_INGRESS_ENABLED',
    'TRADINGVIEW_CERT_PROBE_ENABLED',
  ]) assert.match(config, new RegExp(`^${setting} = "false"$`, 'm'));
  assert.doesNotMatch(config, /^\[\[queues\./m);
  assert.doesNotMatch(config, /^\[triggers\]/m);
  assert.doesNotMatch(config, /^\[\[hyperdrive\]\]/m);
});

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

test('ordinary CI stays lightweight and docs-only edits do not trigger branch or PR CI', async () => {
  const workflow = await readCiWorkflow();
  const testStart = workflow.indexOf('  test:');
  const inventoryStart = workflow.indexOf('  cloudflare-storage-inventory:');
  const testBlock = workflow.slice(testStart, inventoryStart);
  const triggerBlock = workflow.slice(0, workflow.indexOf('jobs:'));

  assert.doesNotMatch(testBlock, /\bwrangler\b/i);
  assert.doesNotMatch(testBlock, /CLOUDFLARE_/);
  assert.doesNotMatch(triggerBlock, /AGENTS\.md/);
  assert.doesNotMatch(triggerBlock, /docs\/superpowers/);
  assert.match(triggerBlock, /push:[\s\S]*?paths:/);
  assert.match(triggerBlock, /pull_request:[\s\S]*?paths:/);
  assert.match(triggerBlock, /cloudflare-v2\/db\/d1-migrations\/\*\*/);
  assert.match(triggerBlock, /cloudflare-v2\/db\/postgres-migrations\/\*\*/);
  assert.match(triggerBlock, /cloudflare-v2\/wrangler\.trading-staging\.toml/);
  assert.match(triggerBlock, /cloudflare-v2\/scripts\/\*\*/);
});

test('feature branch regression runs once via PR while exact push gates still retain test dependency', async () => {
  const workflow = await readCiWorkflow();
  const testStart = workflow.indexOf('  test:');
  const inventoryStart = workflow.indexOf('  cloudflare-storage-inventory:');
  const testBlock = workflow.slice(testStart, inventoryStart);

  assert.match(testBlock, /github\.event_name == 'pull_request'/);
  assert.match(testBlock, /github\.ref == 'refs\/heads\/main'/);
  assert.match(testBlock, /github\.event_name == 'push'/);
  assert.match(testBlock, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(testBlock, /github\.event\.head_commit\.message == 'cloudflare: deploy paid staging gate 2'/);
  assert.match(testBlock, /github\.event\.head_commit\.message == 'cloudflare: accept staging gate 2'/);
  assert.match(testBlock, /github\.event\.head_commit\.message == 'cloudflare: probe tradingview gate 3'/);
  assert.doesNotMatch(testBlock, /cloudflare: inspect staging gate 2/);
  assert.doesNotMatch(testBlock, /cloudflare: inspect tradingview gate 3/);
});

test('Cloudflare inspection is explicit marker-only and remains read-only', async () => {
  const workflow = await readCiWorkflow();
  const start = workflow.indexOf('cloudflare-inspect:');
  const end = workflow.indexOf('cloudflare-deploy-paid:');
  const inspectBlock = workflow.slice(start, end > -1 ? end : undefined);

  assert.match(inspectBlock, /environment:\s*staging/);
  assert.match(inspectBlock, /github\.event_name == 'push'/);
  assert.match(inspectBlock, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(inspectBlock, /github\.event\.head_commit\.message == 'cloudflare: inspect staging gate 2'/);
  assert.match(inspectBlock, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(inspectBlock, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(inspectBlock, /npx wrangler whoami/);
  assert.match(inspectBlock, /npx wrangler deployments list --config wrangler\.toml/);
  assert.doesNotMatch(inspectBlock, /npx wrangler deploy --config wrangler\.toml(?! --dry-run)/);
  assert.doesNotMatch(inspectBlock, /npx wrangler deploy --config wrangler\.free\.toml(?! --dry-run)/);
});

test('Cloudflare inspect records undeployed Workers without hiding real API failures and still checks both profiles', async () => {
  const workflow = await readCiWorkflow();
  assert.match(workflow, /Inspect Paid Worker deployment history[\s\S]*?continue-on-error:\s*true/);
  assert.match(workflow, /Inspect Free Worker deployment history[\s\S]*?continue-on-error:\s*true/);
  assert.match(workflow, /paid_deployments\.outcome/);
  assert.match(workflow, /free_deployments\.outcome/);
  assert.match(workflow, /Worker does not exist on your account|code:\s*10007/);
  assert.match(workflow, /exit 1/);
});

test('Cloudflare inspect inventories queues and container applications read-only', async () => {
  const workflow = await readCiWorkflow();
  const start = workflow.indexOf('cloudflare-inspect:');
  const end = workflow.indexOf('cloudflare-deploy-paid:');
  const inspectBlock = workflow.slice(start, end > -1 ? end : undefined);
  assert.match(inspectBlock, /npx wrangler queues list/);
  assert.match(inspectBlock, /npx wrangler containers list/);
  assert.doesNotMatch(inspectBlock, /wrangler queues create/);
  assert.doesNotMatch(inspectBlock, /wrangler queues delete/);
  assert.doesNotMatch(inspectBlock, /wrangler containers delete/);
  assert.doesNotMatch(inspectBlock, /wrangler containers push/);
});

test('one-shot Paid staging deployment requires exact branch, marker, tests and protected staging environment', async () => {
  const workflow = await readCiWorkflow();
  const start = workflow.indexOf('cloudflare-deploy-paid:');
  assert.ok(start >= 0, 'cloudflare-deploy-paid job must exist');
  const deployBlock = workflow.slice(start);
  assert.match(deployBlock, /needs:\s*test/);
  assert.match(deployBlock, /environment:\s*staging/);
  assert.match(deployBlock, /github\.event_name == 'push'/);
  assert.match(deployBlock, /github\.ref == 'refs\/heads\/design\/enterprise-trading-event-core'/);
  assert.match(deployBlock, /github\.event\.head_commit\.message == 'cloudflare: deploy paid staging gate 2'/);
  assert.match(deployBlock, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(deployBlock, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
});

test('one-shot deployment dry-runs first and deploys Paid profile only with safety vars pinned off', async () => {
  const workflow = await readCiWorkflow();
  const start = workflow.indexOf('cloudflare-deploy-paid:');
  assert.ok(start >= 0, 'cloudflare-deploy-paid job must exist');
  const deployBlock = workflow.slice(start);
  const dryRun = deployBlock.indexOf('npx wrangler deploy --dry-run --config wrangler.toml');
  const realDeploy = deployBlock.indexOf('npx wrangler deploy --config wrangler.toml');
  assert.ok(dryRun >= 0, 'Paid pre-deploy dry-run must exist');
  assert.ok(realDeploy > dryRun, 'real Paid deploy must happen after Paid dry-run');
  assert.doesNotMatch(deployBlock, /npx wrangler deploy --config wrangler\.free\.toml(?! --dry-run)/);
  assert.match(deployBlock, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*["']false["']/);
  assert.match(deployBlock, /TRADINGVIEW_CERT_PROBE_ENABLED:\s*["']false["']/);
  assert.match(deployBlock, /TRADING_ACCESS_ENABLED:\s*["']false["']/);
  assert.match(deployBlock, /BROKER_EXECUTION_ENABLED:\s*["']false["']/);
});
