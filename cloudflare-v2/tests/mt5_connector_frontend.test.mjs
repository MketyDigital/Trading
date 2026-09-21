import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withMt5ConnectorConnections } from '../src/dashboard_mt5_connector_connections.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

test('portal promotes outbound MT5 Connector and keeps HTTP bridge compatibility advanced-only', () => {
  const html = withMt5ConnectorConnections('<html><body><button id="showMt5BridgeBtn">Connect MT5 Bridge</button><button id="showMt5CloudBtn">Connect MT5 Cloud</button><div id="mt5ConnectionForm"></div><div id="unifiedConnectionMessage"></div><div id="oneTimeConnectionSecret"></div><div id="unifiedAccountRows"></div></body></html>');
  assert.match(html, /MT5 Connector — Recommended/);
  assert.match(html, /api\/v1\/admin\/connections\/mt5\/connector/);
  assert.match(html, /MketyMT5Connector\.exe/);
  assert.match(html, /Sync MT5 identity/);
  assert.match(html, /reusable connection token/i);
  assert.match(html, /Paste (?:the )?(?:reusable )?connection token/i);
  assert.doesNotMatch(html, /one-time pairing token/i);
  assert.match(html, /gateway is preconfigured/i);
  assert.doesNotMatch(html, /paste the WebSocket URL/i);
  assert.match(html, /Advanced HTTP Bridge/);
  assert.match(html, /showMt5CloudBtn[^;]*;if\(cloud\)cloud\.style\.display='none'/);
  assert.doesNotMatch(html, /Windows\/VPS agent required/);
  assert.doesNotMatch(html, /public HTTPS/i);
});

test('new MT5 pairing renders a sync action bound directly to returned connector account id', () => {
  const mt5 = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');
  assert.match(mt5, /x\.account/);
  assert.match(mt5, /account\.id/);
  assert.match(mt5, /renderPairingSync/);
  assert.match(mt5, /data-mt5-connector-sync/);
  assert.match(mt5, /syncConnector\(accountId/);
});

test('existing MT5 connector destinations expose token regeneration without recreating the destination', () => {
  const mt5 = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');
  assert.match(mt5, /data-mt5-connector-token/);
  assert.match(mt5, /Regenerate connection token/);
  assert.match(mt5, /\/api\/v1\/admin\/connections\/mt5\/connector\/'\+encodeURIComponent\(id\)\+'\/token/);
  assert.match(mt5, /connectionTokenExpiresAt/);
});

test('connected MT5 connector cards show connected state and refresh is recovery-only', () => {
  const mt5 = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');
  const unified = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_unified_connections.js'), 'utf8');
  assert.match(mt5, /data-provider-status/);
  assert.match(mt5, /connected/);
  assert.match(mt5, /Refresh MT5 connection/);
  assert.match(mt5, /refreshManagers\(\)/);
  assert.match(unified, /Connected/);
  assert.match(unified, /serverName/);
  assert.match(unified, /brokerName/);
});

test('production browser release gate verifies the shipped MT5 Connector contract without authenticating or clicking setup controls', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/production-frontend-e2e.yml'), 'utf8');
  assert.doesNotMatch(workflow, /showAdvancedMt5BridgeBtn/);
  assert.match(workflow, /MT5 Connector — Recommended/);
  assert.match(workflow, /createMt5ConnectorBtn/);
  assert.ok(workflow.includes('assert.match(shippedScripts, /MketyMT5Connector\\.exe/);'));
  assert.match(workflow, /showMt5CloudBtn[^\n]*isVisible\(\)[^\n]*false/);
  assert.doesNotMatch(workflow, /showMt5CloudBtn[^\n]*isVisible\(\)[^\n]*true/);
  assert.doesNotMatch(workflow, /showMt5BridgeBtn[^\n]*\.click\(/);
  assert.doesNotMatch(workflow, /accessCode[^\n]*\.fill\(/);
});


test('production readiness validates persisted LIVE switch consistency instead of forcing LIVE off', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/production-connection-readiness.yml'), 'utf8');
  assert.doesNotMatch(workflow, /LIVE broker execution must remain disabled/);
  assert.match(workflow, /effectiveLiveBrokerExecutionEnabled/);
  assert.match(workflow, /tradingAccessEnabled/);
  assert.match(workflow, /expectedEffectiveLive/);
});
