import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const release = read('.github/workflows/per-account-risk-sizing-release.yml');
const migrations = read('.github/workflows/trading-v1-ci.yml');
const deploy = read('.github/workflows/production-cloudflare-deploy.yml');
const frontend = read('.github/workflows/production-frontend-e2e.yml');
const platform = read('.github/workflows/production-platform-secret-sync.yml');
const readiness = read('.github/workflows/production-connection-readiness.yml');
const mt5 = read('.github/workflows/mt5-connector-release.yml');

test('per-account risk production release is a manually dispatched main-only ordered pipeline', () => {
  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /release_confirmation:[\s\S]*?required: true[\s\S]*?type: string/);
  assert.match(release, /RELEASE_PER_ACCOUNT_RISK_SIZING_TO_PRODUCTION/);
  assert.match(release, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(release, /mt5-connector-vMAJOR\.MINOR\.PATCH/);
  assert.match(release, /concurrency:[\s\S]*?cancel-in-progress: false/);
});

test('production schema migration is completed and verified before the Worker deploy', () => {
  assert.match(release, /schema:[\s\S]*?uses: \.\/\.github\/workflows\/trading-v1-ci\.yml/);
  assert.match(release, /mode: apply-existing-mkety-schema/);
  assert.match(release, /confirmation: APPLY_TRADING_STORAGE_SCHEMA/);
  assert.match(release, /deploy_worker:[\s\S]*?needs: schema[\s\S]*?uses: \.\/\.github\/workflows\/production-cloudflare-deploy\.yml/);
  assert.match(migrations, /workflow_call:[\s\S]*?mode:[\s\S]*?required: true/);
  assert.match(migrations, /inputs\.mode == 'apply-existing-mkety-schema'/);
  assert.match(migrations, /inputs\.confirmation == 'APPLY_TRADING_STORAGE_SCHEMA'/);
  assert.match(migrations, /ENCRYPT_D1_PRE_MIGRATION_EXPORT/);
  assert.match(migrations, /TRADING_PG_MIGRATION_OK=/);
  assert.match(migrations, /successful backup from the last 24 hours/);
  assert.match(migrations, /Apply and verify D1 schema after PostgreSQL migration/);
  assert.match(migrations, /result\.applied\.at\(-1\) === expectedMigrations\.at\(-1\)/);
});

test('production Worker push deploy is suppressed for this PR merge until the ordered release is dispatched', () => {
  assert.match(deploy, /workflow_call:/);
  assert.match(deploy, /\[orchestrated-risk-release\]/);
  assert.match(deploy, /feature\/per-account-risk-sizing/);
});

test('release verifies the deployed frontend and connection readiness before publishing MT5', () => {
  assert.match(release, /platform_configuration:[\s\S]*?needs: deploy_worker[\s\S]*?uses: \.\/\.github\/workflows\/production-platform-secret-sync\.yml/);
  assert.match(platform, /workflow_call:/);
  assert.match(release, /frontend_verification:[\s\S]*?needs: platform_configuration[\s\S]*?uses: \.\/\.github\/workflows\/production-frontend-e2e\.yml/);
  assert.match(frontend, /workflow_call:/);
  assert.match(frontend, /orchestrated-risk-release/);
  assert.match(frontend, /riskPolicyEditable/);
  assert.match(frontend, /Risk mode: percent or fixed_cash/);
  assert.match(frontend, /Only the workspace owner can change risk settings/);
  assert.match(release, /connection_readiness:[\s\S]*?needs: frontend_verification[\s\S]*?uses: \.\/\.github\/workflows\/production-connection-readiness\.yml/);
  assert.match(readiness, /workflow_call:/);
  assert.match(readiness, /orchestrated-risk-release/);
  assert.match(release, /publish_mt5_connector:[\s\S]*?needs: connection_readiness[\s\S]*?uses: \.\/\.github\/workflows\/mt5-connector-release\.yml/);
  assert.match(release, /release_tag: \$\{\{ inputs\.mt5_release_tag \}\}/);
  assert.match(mt5, /workflow_call:[\s\S]*?release_tag:[\s\S]*?required: true/);
});

test('release workflow does not alter runtime controls or import/overwrite customer account policies', () => {
  assert.doesNotMatch(release, /SUPABASE|supabase|UPDATE\s+.*trading_account_followers|DELETE\s+FROM/i);
  assert.doesNotMatch(release, /BROKER_EXECUTION_ENABLED:\s*['"]true/);
});
