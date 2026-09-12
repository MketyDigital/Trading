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
  assert.match(html, /one-time pairing token/i);
  assert.match(html, /Paste (?:the )?one-time (?:pairing )?token/i);
  assert.match(html, /gateway is preconfigured/i);
  assert.doesNotMatch(html, /paste the WebSocket URL/i);
  assert.match(html, /Advanced HTTP Bridge/);
  assert.match(html, /showMt5CloudBtn[^;]*;if\(cloud\)cloud\.style\.display='none'/);
  assert.doesNotMatch(html, /Windows\/VPS agent required/);
  assert.doesNotMatch(html, /public HTTPS/i);
});

test('production browser release gate exercises MT5 Connector instead of expecting legacy MT5 Cloud to remain visible', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/production-frontend-e2e.yml'), 'utf8');
  assert.match(workflow, /showAdvancedMt5BridgeBtn/);
  assert.match(workflow, /MT5 Connector — Recommended/);
  assert.match(workflow, /createMt5ConnectorBtn/);
  assert.match(workflow, /MketyMT5Connector\.exe/);
  assert.match(workflow, /showMt5CloudBtn[^\n]*isVisible\(\)[^\n]*false/);
  assert.doesNotMatch(workflow, /showMt5CloudBtn[^\n]*isVisible\(\)[^\n]*true/);
});
