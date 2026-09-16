import assert from 'node:assert/strict';
import test from 'node:test';
import { withGranularRoutingConsole } from '../src/dashboard_granular_routing.js';
import { withTelegramBotSource } from '../src/dashboard_telegram_bot_source.js';

test('granular routing console exposes feed-scoped routing and reusable Telegram bot endpoints', () => {
  const html = withGranularRoutingConsole('<html><body><main></main></body></html>');
  assert.match(html, /granularRoutingPanel/);
  assert.match(html, /All feeds \/ default/);
  assert.match(html, /sourceFeedId/);
  assert.match(html, /allowedCanonicalSymbols/);
  assert.match(html, /destination-connections/);
  assert.match(html, /credentialConnectionId/);
  assert.match(html, /Add Telegram channel endpoint/);
});

test('normal Telegram Bot API source visibly owns one encrypted bot token and many allowed chats', () => {
  const html = withTelegramBotSource('<html><body><select id="sourceProvider"></select><div id="enterpriseSourceExtras"></div></body></html>');
  assert.match(html, /Telegram Bot API \(normal bot\)/);
  assert.match(html, /Bot token/);
  assert.match(html, /type=\\"password\\"/);
  assert.match(html, /Allowed chat \/ channel IDs/);
  assert.match(html, /credentials:\{botToken:token\}/);
});
