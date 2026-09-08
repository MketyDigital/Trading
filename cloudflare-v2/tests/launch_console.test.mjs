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
  assert.match(html, /Enterprise Owner Workspace/);
  assert.match(html, /Sources/);
  assert.match(html, /Destinations/);
  assert.match(html, /AI Formatting/);
  assert.match(html, /MTProto Setup/);
  assert.match(html, /Domains/);
  assert.match(html, /Risk Inventory/);
  assert.match(html, /Operations &amp; Audit/);
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

test('launch console renders enterprise destination, template, and route controls', () => {
  const html = renderTradingLaunchConsole({
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
    TRADING_CUSTOM_HOSTNAMES_ENABLED: 'true',
  });

  assert.match(html, /id="workspaceId"/);
  assert.match(html, /id="bearer"/);
  assert.match(html, /id="destination-form"/);
  assert.match(html, /id="template-form"/);
  assert.match(html, /id="route-form"/);
  assert.match(html, /data-action="destination-state"/);
  assert.match(html, /data-action="destination-credentials"/);
  assert.match(html, /data-action="template-edit"/);
  assert.match(html, /data-action="route-state"/);
  assert.match(html, /ai_then_fallback/);
});

test('launch console explains MTProto ownership boundaries and never embeds Telegram account secrets', () => {
  const html = renderTradingLaunchConsole({});
  assert.match(html, /External VM/i);
  assert.match(html, /Cloudflare Container/i);
  assert.match(html, /Durable Object/i);
  assert.match(html, /broker execution remains disabled/i);
  assert.equal(/apiId/i.test(html), false);
  assert.equal(/apiHash/i.test(html), false);
  assert.equal(/sessionString/i.test(html), false);
  assert.equal(/botToken/i.test(html), false);
  assert.equal(/signingSecret/i.test(html), false);
});

test('launch console keeps Mkety staff access-code administration out of tenant mutation controls', () => {
  const html = renderTradingLaunchConsole({});
  assert.match(html, /Mkety staff access-code administration is separate/i);
  assert.match(html, /\/mkety-admin\/access-codes/);
  assert.equal(/fetch\(['"]\/api\/v1\/mkety-admin\/access-codes/.test(html), false);
});