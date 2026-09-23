import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from '../src/dashboard.js';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';
import { withSimplifiedAccountControls } from '../src/dashboard_simplified_account_controls.js';
import { withCTraderCbotConnections } from '../src/dashboard_ctrader_cbot_connections.js';
import { withMt5ConnectorConnections } from '../src/dashboard_mt5_connector_connections.js';
import { withTelegramBotSource } from '../src/dashboard_telegram_bot_source.js';
import { withGranularRoutingConsole } from '../src/dashboard_granular_routing.js';

function scripts(html) {
  return [...String(html).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function assertScriptsParse(label, html) {
  const blocks = scripts(html);
  assert.ok(blocks.length > 0, `${label} must contain scripts`);
  for (let i = 0; i < blocks.length; i += 1) {
    try {
      new Function(blocks[i]);
    } catch (error) {
      assert.fail(`${label} script #${i + 1} does not parse: ${error.message}`);
    }
  }
}

test('each production dashboard enhancement preserves parseable inline JavaScript', () => {
  let html = renderDashboard({});
  assertScriptsParse('base dashboard', html);

  const stages = [
    ['unified trading connections', withUnifiedTradingConnections],
    ['simplified account controls', withSimplifiedAccountControls],
    ['cTrader cBot connections', withCTraderCbotConnections],
    ['MT5 connector connections', withMt5ConnectorConnections],
    ['Telegram bot source', withTelegramBotSource],
    ['granular routing console', withGranularRoutingConsole],
  ];

  for (const [label, enhancer] of stages) {
    html = enhancer(html);
    assertScriptsParse(label, html);
  }
});
