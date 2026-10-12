import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { withMt5ConnectorConnections } from '../src/dashboard_mt5_connector_connections.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

function injectedSyncApi({ cards, fetchImpl }) {
  const buttons = cards.map(({ id, provider, connected = false }) => {
    const attributes = { 'data-mt5-connector-sync': id };
    const cardAttributes = { 'data-account-provider': provider, 'data-provider-status': connected ? 'connected' : 'pending' };
    const card = {
      textContent: provider,
      getAttribute(name) { return cardAttributes[name] || null; },
      setAttribute(name, value) { cardAttributes[name] = value; },
      querySelector(selector) { return selector === '[data-mt5-connector-sync]' ? button : null; },
    };
    const button = {
      disabled: false,
      textContent: 'Sync MT5 identity',
      className: 'btn secondary',
      getAttribute(name) { return attributes[name] || null; },
      setAttribute(name, value) { attributes[name] = value; },
      closest(selector) { return selector === '.formbox' ? card : null; },
    };
    return button;
  });
  const notice = { textContent: '', className: '' };
  const document = {
    readyState: 'loading',
    getElementById(id) { return id === 'unifiedConnectionMessage' ? notice : null; },
    querySelectorAll(selector) { return selector === '[data-mt5-connector-sync]' ? buttons : []; },
    addEventListener() {},
    createElement() { return {}; },
  };
  const window = { __mketyRefreshConnectionManagers: async () => {} };
  const html = withMt5ConnectorConnections('<html><body></body></html>');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, {
    window, document, fetch: fetchImpl,
    sessionStorage: { getItem(key) { return key.endsWith('Workspace') ? 'workspace-1' : 'bearer-1'; } },
    setTimeout() {}, encodeURIComponent, MutationObserver: undefined,
  });
  return { api: window.__mketyMt5ConnectorSync, buttons, notice };
}

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

test('batch sync selects only pending MT5 Connector cards and continues after account failures', async () => {
  const calls = [];
  const { api, notice } = injectedSyncApi({
    cards: [
      { id: 'mt5-pending-a', provider: 'mt5_connector' },
      { id: 'mt5-done', provider: 'mt5_connector', connected: true },
      { id: 'ctrader-1', provider: 'ctrader' },
      { id: 'mt5-pending-b', provider: 'mt5_connector' },
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('mt5-pending-b')) return { ok: false, status: 503, json: async () => ({ ok: false, reason: 'TEMPORARY_FAILURE' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, account: { accountId: url.includes('pending-a') ? '100' : '200' } }) };
    },
  });
  assert.deepEqual(Array.from(api.pendingMt5ConnectorIds()), ['mt5-pending-a', 'mt5-pending-b']);
  const results = await api.syncPendingConnectors();
  assert.deepEqual(calls.map((url) => url.split('/').at(-2)), ['mt5-pending-a', 'mt5-pending-b']);
  assert.deepEqual(Array.from(results, (result) => result.ok), [true, false]);
  assert.equal(results[1].error, 'TEMPORARY_FAILURE');
  assert.match(notice.textContent, /1 of 2/);
});

test('batch sync rejects duplicate clicks while one sequential batch is active', async () => {
  let resolveFirst;
  const calls = [];
  const { api } = injectedSyncApi({
    cards: [{ id: 'mt5-pending', provider: 'mt5_connector' }],
    fetchImpl: async () => {
      calls.push('sync');
      return new Promise((resolve) => { resolveFirst = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true, account: {} }) }); });
    },
  });
  const first = api.syncPendingConnectors();
  const duplicate = await api.syncPendingConnectors();
  assert.deepEqual(Array.from(duplicate), []);
  assert.equal(calls.length, 1);
  resolveFirst();
  assert.equal((await first).length, 1);
});

test('connector download uses the stable latest release asset URL', () => {
  const mt5 = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');
  assert.match(mt5, /https:\/\/github\.com\/MketyDigital\/Trading\/releases\/latest\/download\/MketyMT5Connector\.exe/);
  assert.doesNotMatch(mt5, /releases\/download\/mt5-connector-v1\.0\.0\/MketyMT5Connector\.exe/);
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


test('MT5 account observer is idempotent and does not self-trigger on unchanged sync button text', () => {
  const mt5 = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');
  assert.match(mt5, /var label=connected\?'Refresh MT5 connection':'Sync MT5 identity'/);
  assert.match(mt5, /if\(b\.textContent!==label\)b\.textContent=label/);
  assert.doesNotMatch(mt5, /b\.textContent=connected\?'Refresh MT5 connection':'Sync MT5 identity'/);
});

test('pending sync button renderer does not retrigger its own subtree observer', () => {
  const mt5 = fs.readFileSync(path.join(root, 'cloudflare-v2/src/dashboard_mt5_connector_connections.js'), 'utf8');
  assert.match(mt5, /var label='Sync all pending MT5 identities \('\+pending\.length\+'\)';if\(button\.textContent!==label\)button\.textContent=label/);
  assert.doesNotMatch(mt5, /button\.textContent='Sync all pending MT5 identities \('\+pending\.length\+'\)'/);
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
