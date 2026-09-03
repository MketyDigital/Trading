import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ciPath = new URL('../../.github/workflows/trading-v1-ci.yml', import.meta.url);
const readCi = () => readFile(ciPath, 'utf8');

test('Gate 3 zone inventory is exact-marker-only, protected, and read-only', async () => {
  const workflow = await readCi();
  const start = workflow.indexOf('cloudflare-inspect-gate3-zones:');
  assert.ok(start >= 0, 'cloudflare-inspect-gate3-zones job must exist');
  const block = workflow.slice(start);
  assert.match(block, /github\.event\.head_commit\.message == 'cloudflare: inspect tradingview gate 3'/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(block, /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(block, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*['"]false['"]/);
  assert.match(block, /TRADINGVIEW_CERT_PROBE_ENABLED:\s*['"]false['"]/);
  assert.match(block, /TRADING_ACCESS_ENABLED:\s*['"]false['"]/);
  assert.match(block, /BROKER_EXECUTION_ENABLED:\s*['"]false['"]/);
  assert.match(block, /api\.cloudflare\.com\/client\/v4\/zones/);
  assert.match(block, /status=active/);
  assert.match(block, /account\.id=/);
  assert.match(block, /method:\s*GET|curl[^\n]*-X GET/);
  assert.doesNotMatch(block, /wrangler deploy(?!\s+--dry-run)/);
  assert.doesNotMatch(block, /wrangler rollback/);
  assert.doesNotMatch(block, /curl[^\n]*-X (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(block, /TRADINGVIEW_CERT_PROBE_ENABLED:\s*['"]true['"]/);
  assert.doesNotMatch(block, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:\s*['"]true['"]/);
});
