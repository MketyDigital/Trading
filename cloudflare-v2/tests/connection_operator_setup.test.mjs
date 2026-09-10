import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';
import { withCTraderCbotConnections } from '../src/dashboard_ctrader_cbot_connections.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('wrangler configs carry the canonical cTrader redirect URI while credentials remain runtime secrets', () => {
  for (const filename of ['wrangler.toml', 'wrangler.free.toml']) {
    const toml = fs.readFileSync(path.resolve(here, '..', filename), 'utf8');
    assert.match(toml, /CTRADER_REDIRECT_URI\s*=\s*"https:\/\/trade\.mkety\.com\/api\/v1\/integrations\/ctrader\/callback"/);
    assert.doesNotMatch(toml, /CTRADER_CLIENT_SECRET\s*=/);
    assert.doesNotMatch(toml, /CTRADER_CLIENT_ID\s*=/);
  }
});

test('connections UI explains unavailable cTrader and MT5 Cloud setup instead of silently disabling', () => {
  const html = withUnifiedTradingConnections('<html><body><div id="accountRows"></div><div id="sourceRows"></div></body></html>');
  assert.match(html, /cTrader setup required/i);
  assert.match(html, /approved Open API credentials/i);
  assert.match(html, /MT5 Cloud provider is not configured/i);
  assert.doesNotMatch(html, /cb\.disabled=!c\.configured/);
});

test('connections UI exposes recommended Open API and Cloud Auto Trader with create and identity sync actions', () => {
  const base = withUnifiedTradingConnections('<html><body><div id="accountRows"></div><div id="sourceRows"></div></body></html>');
  const html = withCTraderCbotConnections(base);
  assert.match(html, /Direct Connection — Recommended/);
  assert.match(html, /Cloud Auto Trader/);
  assert.match(html, /\/api\/v1\/admin\/connections\/ctrader\/cbot/);
  assert.match(html, /\/sync/);
  assert.match(html, /wss:\/\//);
  assert.match(html, /connection token/i);
});
