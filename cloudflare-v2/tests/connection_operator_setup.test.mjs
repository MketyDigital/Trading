import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

test('production workflow wires optional cTrader credentials and canonical redirect URI', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/production-cloudflare-deploy.yml'), 'utf8');
  assert.match(workflow, /PRODUCTION_CTRADER_CLIENT_ID:\s*\$\{\{ secrets\.CTRADER_CLIENT_ID \}\}/);
  assert.match(workflow, /PRODUCTION_CTRADER_CLIENT_SECRET:\s*\$\{\{ secrets\.CTRADER_CLIENT_SECRET \}\}/);
  assert.match(workflow, /CTRADER_REDIRECT_URI[^\n]*trade\.mkety\.com\/api\/v1\/integrations\/ctrader\/callback/);
});

test('connections UI explains unavailable cTrader and MT5 Cloud setup instead of silently disabling', () => {
  const html = withUnifiedTradingConnections('<html><body><div id="accountRows"></div><div id="sourceRows"></div></body></html>');
  assert.match(html, /cTrader setup required/i);
  assert.match(html, /approved Open API credentials/i);
  assert.match(html, /MT5 Cloud provider is not configured/i);
  assert.doesNotMatch(html, /cb\.disabled=!c\.configured/);
});
