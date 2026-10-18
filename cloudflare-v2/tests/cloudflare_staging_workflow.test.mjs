import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/cloudflare-staging-gate.yml', import.meta.url);
const ciWorkflowPath = new URL('../../.github/workflows/trading-v1-ci.yml', import.meta.url);
const stagingConfigPath = new URL('../wrangler.trading-staging.toml', import.meta.url);
const coolifyProbeDockerfilePath = new URL('../../ops/coolify-staging-postgres-probe/Dockerfile', import.meta.url);
const coolifyProbeScriptPath = new URL('../../ops/coolify-staging-postgres-probe/probe.mjs', import.meta.url);

async function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

async function readCiWorkflow() {
  return readFile(ciWorkflowPath, 'utf8');
}

test('Trading storage PR stages D1 and probes existing PostgreSQL without creating a Coolify database', async () => {
  const workflow = await readCiWorkflow();
  const start = workflow.indexOf('  cloudflare-storage-inventory:');
  const end = workflow.indexOf('\n  cloudflare-inspect:', start);
  assert.ok(start >= 0, 'cloudflare-storage-inventory job must exist');
  assert.ok(end > start, 'storage inventory job must end before the existing inspection job');
  const block = workflow.slice(start, end);
  const normalizedBlock = block.replace(/\\\n\s+/g, ' ');

  assert.match(block, /github\.event_name == 'pull_request'/);
  assert.match(block, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(block, /github\.event\.pull_request\.head\.ref == 'feat\/trading-d1-cutover-implementation'/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /permissions:\s*\n\s+contents:\s*read/);
  assert.match(block, /npm ci[^\n]*\n/);
  assert.match(block, /npx wrangler whoami/);
  assert.match(block, /npx wrangler d1 list --json > "\$RUNNER_TEMP\/trading-d1-inventory\.json"/);
  assert.match(block, /node --input-type=module <<'D1_INVENTORY'/);
  assert.doesNotMatch(block, /wrangler d1 create/i, 'CI must never provision a D1 database');
  assert.match(block, /Trading staging D1 is missing/);
  assert.doesNotMatch(block, /\\n\s+throw new Error\('Existing Trading staging D1 is missing/,
    'the D1 inventory guard must contain real JavaScript newlines, not escaped text');
  assert.match(block, /database_name = "trading-staging"/);
  assert.match(block, /migrations_dir = "db\/d1-migrations"/);
  assert.match(block, /npx wrangler d1 migrations apply trading-staging --remote --config wrangler\.trading-staging\.toml/);
  assert.match(block, /npx wrangler d1 migrations list trading-staging --remote --config wrangler\.trading-staging\.toml/);
  assert.match(normalizedBlock, /wrangler d1 execute trading-staging --remote --config wrangler\.trading-staging\.toml --json\s+--command .*sqlite_master/);
  assert.match(normalizedBlock, /compareD1MigrationTableInventory/);
  assert.match(normalizedBlock, /Remote Trading D1 exact schema check passed/);
  assert.match(block, /Check access to the existing Coolify PostgreSQL database/);
  assert.match(block, /TRADING_PG_STAGING_DATABASE_URL: \$\{\{ secrets\.TRADING_PG_STAGING_DATABASE_URL \}\}/);
  assert.match(block, /Existing Coolify PostgreSQL connection secret is configured/);
  assert.match(block, /Existing Coolify PostgreSQL connection secret is not configured/);
  assert.match(block, /generic staging database credential is configured; it is not approved for Trading use/);
  assert.doesNotMatch(block, /echo [^\n]*\$\{(?:TRADING_PG_STAGING_DATABASE_URL|STAGING_DATABASE_URL)/);
  assert.match(block, /Create ephemeral private-network Trading PostgreSQL probe host/);
  assert.match(block, /connect_to_docker_network:\s*true/);
  assert.match(block, /\/applications\/public/);
  assert.match(block, /Coolify probe-host create response was uncertain/);
  assert.match(block, /RECOVERED_UUID/);
  assert.match(block, /Coolify PostgreSQL CA mount/);
  assert.match(block, /data\/coolify\/ssl\/coolify-ca\.crt/);
  assert.match(block, /applications\/\$APP_UUID\/storages/);
  assert.match(block, /TRADING_PG_CA_FILE/);
  assert.match(block, /TRADING_PG_EXPECTED_DATABASE/);
  assert.match(block, /EXPECTED_DATABASE='mkety'/);
  assert.match(block, /TRADING_PG_STAGING_DATABASE_URL: \$\{\{ secrets\.TRADING_PG_STAGING_DATABASE_URL \}\}/);
  assert.match(block, /\/applications\/\$APP_UUID\/envs/);
  assert.match(block, /Deploy exact-commit Trading PostgreSQL (?:read-only probe|probe or schema-only migration)/);
  assert.match(block, /TRADING_PG_PROBE_OK=/);
  assert.match(block, /Sanitized Coolify deployment status/);
  assert.match(block, /postgresql:\/\/\*\*/);
  assert.match(block, /Delete ephemeral Trading PostgreSQL probe host/);
  assert.match(block, /if: always\(\) && steps\.postgres-probe-app\.outputs\.app_uuid != ''/);
  assert.doesNotMatch(block, /-X (?:POST|PATCH|PUT|DELETE)[^\n]*\/databases\//i);
  assert.match(block, /concurrency:\s*\n\s+group: trading-coolify-postgres-staging/);
  assert.match(block, /timeout-minutes:\s*35/);
  assert.match(block, /git_commit_sha:\s*sha,/);
  assert.match(block, /autogenerate_domain:\s*false/);
  assert.match(block, /-X DELETE/);
  assert.match(block, /applications\/\$APP_UUID/);
  const dockerfile = await readFile(coolifyProbeDockerfilePath, 'utf8');
  assert.match(dockerfile, /cloudflare-v2\/package-lock\.json/);
  assert.match(dockerfile, /USER node/);
  const probeScript = await readFile(coolifyProbeScriptPath, 'utf8');
  assert.match(probeScript, /checkStagingPostgresConnection/);
  assert.match(probeScript, /TRADING_PG_PROBE_OK=/);
  assert.doesNotMatch(probeScript, /postgres-migrations|CREATE DATABASE|CREATE SCHEMA|INSERT INTO|UPDATE .* SET|DELETE FROM/i);
  assert.match(block, /Inventory Coolify database resources \(read-only\)/);
  assert.match(block, /OCI_COOLIFY_URL: \$\{\{ secrets\.OCI_COOLIFY_URL \}\}/);
  assert.match(block, /OCI_COOLIFY_TOKEN: \$\{\{ secrets\.OCI_COOLIFY_TOKEN \}\}/);
  assert.match(block, /\"\$api\/databases\" > \"\$RUNNER_TEMP\/coolify-database-inventory\.json\"/);
  assert.match(block, /Coolify Trading\/PostgreSQL candidates \(safe fields only\)/);
  assert.match(block, /\$api\/databases\/\$target_uuid/);
  assert.match(block, /\$api\/databases\/\$target_uuid\/envs/);
  assert.match(block, /\$api\/databases\/\$target_uuid\/backups/);
  assert.match(block, /\$api\/databases\/\$target_uuid\/backups\/\$backup_uuid\/executions/);
  assert.match(block, /Coolify PostgreSQL backup schedules \(safe fields only\)/);
  assert.match(block, /Coolify PostgreSQL backup executions \(safe fields only\)/);
  assert.match(block, /backupUuid, count: safe\.length, latest: safe\[0\]/);
  assert.match(block, /BACKUP_EXECUTIONS_PATH=.*node <<'SAFE_COOLIFY_BACKUP_EXECUTIONS'\n\s+import \{ readFile, writeFile \} from 'node:fs\/promises'/);
  assert.match(block, /last 24 hours/);
  assert.match(block, /trading-pg-backup-preflight\.json/);
  assert.match(block, /APPLY_MODE: \$\{\{ inputs\.mode \}\}/);
  assert.match(block, /MIGRATION_CONFIRMATION: \$\{\{ inputs\.confirmation \}\}/);
  assert.match(block, /APPLY_TRADING_STORAGE_SCHEMA/);
  assert.match(block, /TRADING_PG_MIGRATION_OK=/);
  assert.match(block, /Existing mkety Trading schema migration verified/);
  assert.match(block, /Coolify central PostgreSQL metadata \(safe fields only\)/);
  assert.match(block, /hasDatabasePassword: keys\.has\('POSTGRES_PASSWORD'\)/);
  assert.match(block, /\$api\/projects\/\$project_uuid\/environments/);
  assert.match(block, /Coolify central project environments \(safe fields only\)/);
  assert.match(block, /\$api\/servers\/\$server_uuid\/destinations/);
  assert.match(block, /Coolify central server destinations \(safe fields only\)/);
  const inventoryStart = block.indexOf('name: Inventory Coolify database resources (read-only)');
  const probeStart = block.indexOf('name: Create ephemeral private-network Trading PostgreSQL probe host', inventoryStart);
  assert.ok(inventoryStart >= 0 && probeStart > inventoryStart, 'inventory must precede the temporary probe host');
  const inventoryStep = block.slice(inventoryStart, probeStart);
  const probeStep = block.slice(probeStart);
  assert.match(inventoryStep, /trap '[^']*coolify-\*\.json/);
  assert.match(inventoryStep, /trading-pg-backup-preflight\.json/);
  assert.doesNotMatch(inventoryStep, /trap '[^']*trading-pg-backup-preflight\.json/);
  assert.match(probeStep, /trap '[^']*trading-pg-backup-preflight\.json/);
  assert.match(probeStep, /test -s "\$RUNNER_TEMP\/trading-pg-backup-preflight\.json"/);
  assert.doesNotMatch(block, /\/databases\/[^\s]+\/(?:start|stop|delete)|\/services\/[^\s]+\/databases\/(?:[^\s]+\/)?(?:start|stop|delete)/i);
  assert.doesNotMatch(block, /console\.log\([^\n]*(?:password|connection_string|postgres_user|postgres_password|docker_compose)/i);
  assert.match(block, /Inspect existing Cloudflare Worker database and private-network bindings \(read-only\)/);
  assert.match(block, /\$base\/hyperdrive\/configs\?per_page=100/);
  assert.match(block, /\$base\/cfd_tunnel\?is_deleted=false&per_page=100/);
  assert.match(block, /\$base\/workers\/scripts\/mkety-copier-engine\/settings/);
  assert.match(block, /Cloudflare Hyperdrive inventory \(safe fields only\)/);
  assert.match(block, /Cloudflare Tunnel inventory \(safe fields only\)/);
  assert.match(block, /Production Worker database bindings \(safe fields only\)/);
  assert.doesNotMatch(block, /console\.log\([^\n]*(?:host|hostname|user|username|password|connection string|connection_string|access_client_secret)/i);
  assert.doesNotMatch(block, /hyperdrive\/configs[^\n]*-X (?:POST|PATCH|PUT|DELETE)/i);
  assert.doesNotMatch(block, /cfd_tunnel[^\n]*-X (?:POST|PATCH|PUT|DELETE)/i);
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

test('Cloudflare staging gate is inspect-only and has no Supabase deploy path', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /mode:/);
  assert.match(workflow, /default:\s*inspect/);
  assert.match(workflow, /options:\s*\n\s+- inspect/);
  assert.doesNotMatch(workflow, /deploy-paid|deploy-free|SUPABASE|supabase/i);
  assert.doesNotMatch(workflow, /wrangler deploy --config (?:wrangler\.toml|wrangler\.free\.toml|wrangler\.trading-staging\.toml)/);
  assert.match(workflow, /wrangler\.trading-staging\.toml/);
});

test('Cloudflare staging gate keeps TradingView ingress and broker execution disabled', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*["']false["']/);
  assert.match(workflow, /TRADINGVIEW_CERT_PROBE_ENABLED:\s*["']false["']/);
  assert.match(workflow, /TRADING_ACCESS_ENABLED:\s*["']false["']/);
  assert.match(workflow, /BROKER_EXECUTION_ENABLED:\s*["']false["']/);
});

test('Cloudflare staging gate only dry-runs and inspects the reviewed Trading target', async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /npx wrangler deploy --dry-run --containers-rollout=none --config wrangler\.trading-staging\.toml/);
  assert.match(workflow, /npx wrangler d1 migrations list trading-staging --remote --config wrangler\.trading-staging\.toml/);
  assert.doesNotMatch(workflow, /npx wrangler deploy --config/);
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

test('existing mkety inspect is read-only and schema apply remains exact-confirmation-only and branch-bound', async () => {
  const workflow = await readCiWorkflow();
  const triggerBlock = workflow.slice(0, workflow.indexOf('permissions:'));
  const testStart = workflow.indexOf('  test:');
  const inventoryStart = workflow.indexOf('  cloudflare-storage-inventory:');
  const testBlock = workflow.slice(testStart, inventoryStart);
  const inventoryBlock = workflow.slice(inventoryStart, workflow.indexOf('\n  cloudflare-inspect:', inventoryStart));

  assert.match(triggerBlock, /workflow_dispatch:[\s\S]*?default: inspect[\s\S]*?apply-existing-mkety-schema/);
  assert.match(triggerBlock, /import-existing-trading-data/);
  assert.equal((triggerBlock.match(/^  workflow_dispatch:/gm) || []).length, 1,
    'workflow_dispatch must be declared only once');
  assert.match(triggerBlock, /confirmation:[\s\S]*?type: string/);
  assert.match(triggerBlock, /freeze_evidence:[\s\S]*?source-freeze/);
  assert.match(testBlock, /github\.event_name == 'workflow_dispatch'/);
  assert.match(testBlock, /github\.ref == 'refs\/heads\/feat\/trading-d1-cutover-implementation'/);
  assert.match(testBlock, /inputs\.mode == 'inspect'/);
  assert.match(testBlock, /inputs\.confirmation == 'APPLY_TRADING_STORAGE_SCHEMA'/);
  assert.match(testBlock, /inputs\.confirmation == 'IMPORT_TRADING_DATA_TO_EXISTING_TARGETS'/);
  assert.match(testBlock, /startsWith\(inputs\.freeze_evidence, 'source-freeze:'\)/);
  assert.match(inventoryBlock, /inputs\.mode == 'inspect'/);
  assert.match(inventoryBlock, /inputs\.mode == 'apply-existing-mkety-schema'/);
  assert.match(inventoryBlock, /inputs\.confirmation == 'APPLY_TRADING_STORAGE_SCHEMA'/);
  assert.match(inventoryBlock, /successful backup from the last 24 hours/);
  assert.match(inventoryBlock, /TRADING_PG_SCHEMA_MIGRATION_CONFIRM/);
  assert.match(inventoryBlock, /TRADING_SNAPSHOT_IMPORT_CONFIRM/);
  assert.match(inventoryBlock, /targetsParityVerified/);
  assert.match(inventoryBlock, /authorityActivated/);
  assert.match(inventoryBlock, /Delete ephemeral Trading PostgreSQL probe host/);
  assert.match(inventoryBlock, /if \[ "\$STAGING_MODE" = 'apply-existing-mkety-schema' \]; then\n\s+npx wrangler d1 migrations apply trading-staging --remote --config wrangler\.trading-staging\.toml[\s\S]*?\n\s+fi/,
    'D1 schema changes must require the exact schema-apply mode');
  assert.doesNotMatch(inventoryBlock, /npx wrangler (?:deploy --config wrangler\.toml|deploy --config wrangler\.free\.toml)/);
  assert.doesNotMatch(inventoryBlock, /-X (?:POST|PATCH|PUT|DELETE)[^\n]*\/databases\//i);
  const dockerfile = await readFile(coolifyProbeDockerfilePath, 'utf8');
  assert.match(dockerfile, /scripts\/run_trading_snapshot_import\.mjs/);
  assert.match(dockerfile, /db\/d1-migrations/);
  const probe = await readFile(coolifyProbeScriptPath, 'utf8');
  assert.match(probe, /runTradingSnapshotImport/);
  const importer = await readFile(new URL('../scripts/run_trading_snapshot_import.mjs', import.meta.url), 'utf8');
  assert.match(importer, /source drifted during export/);
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
