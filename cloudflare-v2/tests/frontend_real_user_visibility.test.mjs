import test from 'node:test';
import assert from 'node:assert/strict';

import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';
import { withEnterpriseConnectionEnhancements } from '../src/dashboard_enterprise_enhancements.js';
import { withTelegramBotSource } from '../src/dashboard_telegram_bot_source.js';
import { withGranularRoutingConsole } from '../src/dashboard_granular_routing.js';

test('composed Connections UI exposes normal Telegram bot source and a stable token/chat panel', () => {
  const html = withTelegramBotSource(withEnterpriseConnectionEnhancements(renderEnterpriseTradingPortal({})));

  assert.match(html, /Telegram Bot API \(normal bot\)/);
  assert.match(html, /telegramBotSourceFields/);
  assert.match(html, /sourceBotToken/);
  assert.match(html, /Bot token/);
  assert.match(html, /sourceBotChats/);
  assert.match(html, /Allowed chat \/ channel IDs/);
  assert.match(html, /type="password"/);
  assert.match(html, /credentials:\{botToken:token\}/);
  assert.match(html, /independently/);
});

test('composed real-user portal exposes granular feed routing and shared Telegram delivery bot controls', () => {
  const html = withGranularRoutingConsole(withTelegramBotSource(withEnterpriseConnectionEnhancements(renderEnterpriseTradingPortal({}))));

  assert.match(html, /Granular source routing/);
  assert.match(html, /All feeds \/ default/);
  assert.match(html, /Allowed canonical symbols/);
  assert.match(html, /Reusable Telegram delivery bot/);
  assert.match(html, /Save new bot credential/);
  assert.match(html, /Add Telegram channel endpoint/);
  assert.match(html, /Source connections & feeds/);
});
