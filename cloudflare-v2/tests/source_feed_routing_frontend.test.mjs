import assert from 'node:assert/strict';
import test from 'node:test';
import { withGranularRoutingConsole } from '../src/dashboard_granular_routing.js';
import { withTelegramBotSource } from '../src/dashboard_telegram_bot_source.js';

test('granular routing console exposes simple multi-feed logical routes and reusable Telegram bot endpoints', () => {
  const html = withGranularRoutingConsole('<html><body><main></main></body></html>');
  assert.match(html, /granularRoutingPanel/);
  assert.match(html, /All channels from this source/i);
  assert.match(html, /select the exact channels\/feeds allowed to reach (?:this|a) destination/i);
  assert.match(html, /granularRouteFeeds/);
  assert.match(html, /logical-routes\/reconcile/);
  assert.match(html, /Leave both symbol filters blank to allow every symbol this destination account can actually trade/i);
  assert.match(html, /allowedCanonicalSymbols/);
  assert.match(html, /destination-connections/);
  assert.match(html, /credentialConnectionId/);
  assert.match(html, /Add Telegram channel endpoint/);
});

test('route editor visibly explains strict selective behavior', () => {
  const html = withGranularRoutingConsole('<html><body><main></main></body></html>');
  assert.match(html, /Only checked channels reach this destination/i);
  assert.match(html, /Unchecked channels are skipped for this route/i);
  assert.match(html, /Existing routes use this same editor/i);
});

test('editing a logical route preserves and submits the exact underlying route ids', () => {
  const html = withGranularRoutingConsole('<html><body><main></main></body></html>');
  assert.match(html, /routeIds:r\.routeIds\|\|\[\]/);
  assert.match(html, /previousRouteIds:state\.editingRouteOriginal&&state\.editingRouteOriginal\.routeIds\|\|\[\]/);
});

test('stored all-channels rows suppressed by selective authority are labeled clearly', () => {
  const html = withGranularRoutingConsole('<html><body><main></main></body></html>');
  assert.match(html, /suppressedBySelectiveRoutes/);
  assert.match(html, /suppressed by selective routes/i);
});

test('destination formatting UI exposes all four ready-made modes in plain language', () => {
  const html = withGranularRoutingConsole('<html><body><main></main></body></html>');
  assert.match(html, /Forward as-is \(original\)/i);
  assert.match(html, /No AI, no cleanup, no reformatting, no branding/i);
  assert.match(html, /Clean original/i);
  assert.match(html, /Structured template/i);
  assert.match(html, /AI presentation \+ safe fallback/i);
});

test('normal Telegram Bot API source visibly owns one encrypted bot token and many allowed chats', () => {
  const html = withTelegramBotSource('<html><body><select id="sourceProvider"></select><div id="enterpriseSourceExtras"></div></body></html>');
  assert.match(html, /Telegram Bot API \(normal bot\)/);
  assert.match(html, /Bot token/);
  assert.match(html, /type="password"/);
  assert.match(html, /Allowed chat \/ channel IDs/);
  assert.match(html, /credentials:\{botToken:token\}/);
});