import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ciPath = new URL('../../.github/workflows/trading-v1-ci.yml', import.meta.url);
const readCi = () => readFile(ciPath, 'utf8');

function jobBlock(workflow, jobName, nextJobName = null) {
  const start = workflow.indexOf(`  ${jobName}:`);
  assert.ok(start >= 0, `${jobName} job must exist`);
  const end = nextJobName ? workflow.indexOf(`  ${nextJobName}:`, start + 1) : -1;
  return workflow.slice(start, end >= 0 ? end : undefined);
}

test('Gate 3 zone inventory is exact-marker-only, protected, and read-only', async () => {
  const workflow = await readCi();
  const block = jobBlock(workflow, 'cloudflare-inspect-gate3-zones', 'cloudflare-probe-gate3-tradingview');
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

test('Gate 3 certificate probe is exact-marker-only, protected, fail-closed, and always rolls back', async () => {
  const workflow = await readCi();
  const block = jobBlock(workflow, 'cloudflare-probe-gate3-tradingview');
  assert.match(block, /needs:\s*test/);
  assert.match(block, /github\.event\.head_commit\.message == 'cloudflare: probe tradingview gate 3'/);
  assert.match(block, /environment:\s*staging/);
  assert.match(block, /GATE3_HOSTNAME:\s*trade\.mkety\.com/);
  assert.match(block, /GATE3_ZONE_ID:\s*98c7228a0457b1f454881c149e2df6ce/);
  assert.match(block, /api\.cloudflare\.com\/client\/v4\/accounts\/\$\{CLOUDFLARE_ACCOUNT_ID\}\/workers\/domains/);
  assert.match(block, /api\.cloudflare\.com\/client\/v4\/zones\/\$\{GATE3_ZONE_ID\}\/dns_records/);
  assert.match(block, /wrangler deploy[\s\S]*--domain (?:trade\.mkety\.com|\$\{?GATE3_HOSTNAME\}?)/);
  assert.match(block, /--containers-rollout none/);
  assert.match(block, /--var TRADINGVIEW_DIRECT_INGRESS_ENABLED:false/);
  assert.match(block, /--var TRADINGVIEW_CERT_PROBE_ENABLED:true/);
  assert.match(block, /--var TRADING_ACCESS_ENABLED:false/);
  assert.match(block, /--var BROKER_EXECUTION_ENABLED:false/);
  assert.match(block, /wrangler tail/);
  assert.match(block, /TRADINGVIEW_CERT_PROBE/);
  assert.match(block, /wrangler rollback c25e85d5-bfe2-4d17-9ab4-5133d88ecec8/);
  assert.match(block, /always\(\).*probe_deploy\.outcome == 'success'/);
  assert.doesNotMatch(block, /TRADINGVIEW_DIRECT_INGRESS_ENABLED:true/);
  assert.doesNotMatch(block, /BROKER_EXECUTION_ENABLED:true/);
});

test('Gate 3 probe checks Trading hostname conflicts before mutation and proves spoof rejection', async () => {
  const workflow = await readCi();
  const block = jobBlock(workflow, 'cloudflare-probe-gate3-tradingview');
  const conflict = block.indexOf('Check dedicated TradingView hostname conflicts read-only');
  const deploy = block.indexOf('Deploy temporary certificate-probe Worker');
  assert.ok(conflict >= 0, 'hostname conflict check must exist');
  assert.ok(deploy > conflict, 'probe deployment must happen only after conflict checks');
  assert.match(block, /hostname=\$\{GATE3_HOSTNAME\}|hostname=trade\.mkety\.com/);
  assert.match(block, /name=\$\{GATE3_HOSTNAME\}|name=trade\.mkety\.com/);
  assert.match(block, /HTTP[^\n]*403|status[^\n]*403|\[ "\$status" != "403" \]/);
  assert.match(block, /x-tradingview-client-cert/i);
  assert.doesNotMatch(block, /tradingview\.mkety\.app/);
});
