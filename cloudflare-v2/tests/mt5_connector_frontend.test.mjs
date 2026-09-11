import test from 'node:test';
import assert from 'node:assert/strict';

import { withMt5ConnectorConnections } from '../src/dashboard_mt5_connector_connections.js';

test('portal promotes outbound MT5 Connector and keeps HTTP bridge compatibility advanced-only', () => {
  const html = withMt5ConnectorConnections('<html><body><button id="showMt5BridgeBtn">Connect MT5 Bridge</button><div id="mt5ConnectionForm"></div><div id="unifiedConnectionMessage"></div><div id="oneTimeConnectionSecret"></div><div id="unifiedAccountRows"></div></body></html>');
  assert.match(html, /MT5 Connector — Recommended/);
  assert.match(html, /api\/v1\/admin\/connections\/mt5\/connector/);
  assert.match(html, /wss:\/\//);
  assert.match(html, /MketyMT5Connector\.exe/);
  assert.match(html, /Sync MT5 identity/);
  assert.match(html, /one-time pairing token/i);
  assert.match(html, /Advanced HTTP Bridge/);
  assert.doesNotMatch(html, /Windows\/VPS agent required/);
  assert.doesNotMatch(html, /public HTTPS/i);
});
