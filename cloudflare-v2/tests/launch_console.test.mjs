import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTradingLaunchConsole } from '../src/dashboard_launch_console.js';

test('launch console exposes the approved setup surfaces without secret values', () => {
  const html = renderTradingLaunchConsole({
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
    TRADING_CUSTOM_HOSTNAMES_ENABLED: 'false',
  });

  assert.match(html, /Mkety Trading Launch Console/);
  assert.match(html, /Mkety Admin Access Codes/);
  assert.match(html, /Enterprise Owner Workspace/);
  assert.match(html, /Sources/);
  assert.match(html, /Destinations/);
  assert.match(html, /AI Formatting/);
  assert.match(html, /MTProto Setup/);
  assert.match(html, /Domains/);
  assert.match(html, /Risk Inventory/);
  assert.match(html, /Operations &amp; Audit/);
  assert.match(html, /\/api\/v1\/mkety-admin\/access-codes/);
  assert.match(html, /\/api\/v1\/admin\/destinations/);
  assert.match(html, /\/api\/v1\/admin\/templates/);
  assert.match(html, /\/api\/v1\/admin\/routes/);
  assert.match(html, /external_mtproto/);
  assert.match(html, /cloudflare_container_mtproto/);
  assert.match(html, /cloudflare_do_mtproto/);
  assert.match(html, /BROKER_EXECUTION_ENABLED=false/);
  assert.equal(html.includes('apiHash:'), false);
  assert.equal(html.includes('session:'), false);
});
