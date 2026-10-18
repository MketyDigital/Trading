import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflow = fs.readFileSync(path.resolve(here, '../../.github/workflows/production-cloudflare-deploy.yml'), 'utf8');

test('production deploy reads and verifies owner switch without requiring OFF or mutating it', () => {
  assert.match(workflow, /brokerExecutionCapabilityEnabled/);
  assert.match(workflow, /brokerExecutionEnabled/);
  assert.match(workflow, /effectiveBrokerExecutionEnabled/);
  assert.doesNotMatch(workflow, /owner broker switch must remain OFF/i);
  assert.doesNotMatch(workflow, /effective broker execution must remain blocked/i);
  assert.doesNotMatch(workflow, /Broker owner master switch: OFF/);
  assert.doesNotMatch(workflow, /method:\s*['\"]?PATCH/i);
  assert.doesNotMatch(workflow, /curl[^\n]*-X\s+PATCH[^\n]*runtime-controls/i);
  assert.match(workflow, /effectiveBrokerExecutionEnabled[^\n]*brokerExecutionCapabilityEnabled[^\n]*brokerExecutionEnabled|expectedEffective/);
});

test('production deploy stops before Cloudflare mutations when Trading storage bindings are incomplete', () => {
  const preflightAt = workflow.indexOf('name: Require production Trading storage bindings and fail-closed execution');
  const cloudflareMutationAt = workflow.indexOf('name: Configure Cloudflare for SaaS white-label foundation');
  const deployAt = workflow.indexOf('npx wrangler deploy --config wrangler.production.generated.toml --secrets-file');
  assert.ok(preflightAt >= 0, 'production storage preflight must exist');
  assert.ok(cloudflareMutationAt > preflightAt, 'storage preflight must run before DNS and SaaS mutations');
  assert.ok(deployAt > preflightAt, 'storage preflight must run before production deploy');
  const preflight = workflow.slice(preflightAt, cloudflareMutationAt);
  assert.match(preflight, /\[\[d1_databases\]\]/);
  assert.match(preflight, /value\(d1,\s*["']binding["']\)\s*!==\s*["']DB["']/);
  assert.match(preflight, /\[\[hyperdrive\]\]/);
  assert.match(preflight, /value\(hyperdrive,\s*["']binding["']\)\s*!==\s*["']TRADING_PG["']/);
  assert.match(preflight, /requireVar\(["']TRADING_STORAGE_AUTHORITY["'],\s*["']d1["']\)/);
  assert.match(preflight, /requireVar\(["']LIVE_BROKER_EXECUTION_ENABLED["'],\s*["']false["']\)/);
  assert.doesNotMatch(preflight, /(?:curl|wrangler)\s+[^\n]*(?:-X\s+(?:POST|PUT|PATCH|DELETE)|\bdeploy\b)/i);
});
