import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';
import { withSimplifiedAccountControls } from '../src/dashboard_simplified_account_controls.js';
import { withCTraderCbotConnections } from '../src/dashboard_ctrader_cbot_connections.js';
import { withMt5ConnectorConnections } from '../src/dashboard_mt5_connector_connections.js';
import { withTelegramBotSource } from '../src/dashboard_telegram_bot_source.js';
import { withGranularRoutingConsole } from '../src/dashboard_granular_routing.js';

function composeRealUserPortal() {
  return withGranularRoutingConsole(
    withTelegramBotSource(
      withMt5ConnectorConnections(
        withCTraderCbotConnections(
          withSimplifiedAccountControls(
            withUnifiedTradingConnections(renderEnterpriseTradingPortal({})),
          ),
        ),
      ),
    ),
  );
}

test('real v1 connections entrypoint composes the same user-facing modules covered by this regression', async () => {
  const entry = await readFile(new URL('../src/v1_connections_entry.js', import.meta.url), 'utf8');
  assert.match(entry, /withUnifiedTradingConnections/);
  assert.match(entry, /withSimplifiedAccountControls/);
  assert.match(entry, /withCTraderCbotConnections/);
  assert.match(entry, /withMt5ConnectorConnections/);
  assert.match(entry, /withTelegramBotSource/);
  assert.match(entry, /withGranularRoutingConsole/);
});

test('actual composed Connections UI exposes normal Telegram bot source and a stable token/chat panel', () => {
  const html = composeRealUserPortal();

  assert.match(html, /Telegram Bot API \(normal bot\)/);
  assert.match(html, /telegramBotSourceFields/);
  assert.match(html, /sourceBotToken/);
  assert.match(html, /Bot token/);
  assert.match(html, /sourceBotChats/);
  assert.match(html, /Allowed chat \/ channel IDs/);
  assert.match(html, /type="password"/);
  assert.match(html, /credentials:\{botToken:token\}/);
  assert.match(html, /each allowed chat can be routed independently/);
});

test('actual composed real-user portal exposes broker setup, granular routing and reusable Telegram delivery controls', () => {
  const html = composeRealUserPortal();

  assert.match(html, /cTrader/i);
  assert.match(html, /MT5/i);
  assert.match(html, /Granular source routing/);
  assert.match(html, /All feeds \/ default/);
  assert.match(html, /Allowed canonical symbols/);
  assert.match(html, /Reusable Telegram delivery bot/);
  assert.match(html, /Save new bot credential/);
  assert.match(html, /Add Telegram channel endpoint/);
  assert.match(html, /Source connections & feeds/);
});
