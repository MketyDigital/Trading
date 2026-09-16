import test from 'node:test';
import assert from 'node:assert/strict';

import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';
import { withEnterpriseConnectionEnhancements } from '../src/dashboard_enterprise_enhancements.js';

test('main Connections UI exposes normal Telegram bot source as a first-class provider', () => {
  const html = withEnterpriseConnectionEnhancements(renderEnterpriseTradingPortal({}));

  assert.match(html, /option value="telegram_bot_api">Telegram Bot API \(normal bot\)<\/option>/);
  assert.match(html, /sourceBotToken/);
  assert.match(html, /Bot token/);
  assert.match(html, /sourceBotChats/);
  assert.match(html, /Allowed chat \/ channel IDs/);
  assert.match(html, /telegram_bot_api:\['telegram','telegram_bot'\]/);
  assert.match(html, /credentials:\{botToken:/);
});

test('routing UI exposes granular feed routing and shared Telegram delivery bot controls to real users', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/dashboard_granular_routing.js', import.meta.url), 'utf8'));

  assert.match(source, /Granular source routing/);
  assert.match(source, /All feeds \/ default/);
  assert.match(source, /Allowed canonical symbols/);
  assert.match(source, /Reusable Telegram delivery bot/);
  assert.match(source, /Save new bot credential/);
  assert.match(source, /Add Telegram channel endpoint/);
  assert.match(source, /Source connections & feeds/);
});
