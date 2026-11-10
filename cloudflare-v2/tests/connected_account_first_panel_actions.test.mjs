import test from 'node:test';
import assert from 'node:assert/strict';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';
import { withSimplifiedAccountControls } from '../src/dashboard_simplified_account_controls.js';
import { withMt5ConnectorConnections } from '../src/dashboard_mt5_connector_connections.js';

function renderFirstPanelButtons(account) {
  const html = withSimplifiedAccountControls(withUnifiedTradingConnections('<html><body></body></html>'));
  const start = html.indexOf('function accountButtons(x){');
  const end = html.indexOf('function accountSizingEditor', start);
  assert.ok(start >= 0 && end > start, 'shipped account button renderer must exist');
  const body = html.slice(start, end);
  const render = new Function('x', 'esc', body + '\nreturn accountButtons(x);');
  return render(account, value => String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
}

const base = {
  id: 'acc-test',
  providerMode: 'mt5_connector',
  providerConfig: { status: 'connected' },
  roles: ['execution'],
  environment: 'live',
  tradingEnabled: true,
  liveExecutionEnabled: false,
};

test('first connected MT5 account card renders stable token and refresh controls before any DOM observer executes', () => {
  const html = renderFirstPanelButtons(base);
  assert.match(html, /data-mt5-connector-token="acc-test"/);
  assert.match(html, /Regenerate connection token/);
  assert.match(html, /data-mt5-connector-sync="acc-test"/);
  assert.match(html, /Refresh MT5 connection/);
  assert.match(html, /data-account-edit="acc-test"/);
  assert.match(html, /data-account-sizing-toggle="acc-test"/);
  assert.match(html, /Configure sizing/);
  assert.match(html, /data-account-remove="acc-test"/);
  assert.match(html, /data-account-live="acc-test"/);
});

test('pending MT5 card has sync action, while non-MT5 accounts never display connector-token actions', () => {
  assert.match(renderFirstPanelButtons({ ...base, providerConfig: { status: 'pending' } }), /Sync MT5 identity/);
  const other = renderFirstPanelButtons({ ...base, providerMode: 'ctrader_oauth' });
  assert.doesNotMatch(other, /data-mt5-connector-token|data-mt5-connector-sync/);
  assert.match(other, /Configure sizing/);
});

test('existing pre-rendered MT5 action buttons receive their real click handlers after refresh', () => {
  const html = withMt5ConnectorConnections('<html><body></body></html>');
  assert.match(html, /tokenButton\.onclick=function\(\)\{regenerateConnectorToken\(id,tokenButton\)\}/);
  assert.match(html, /b\.onclick=function\(\)\{syncConnector\(id,b\)\}/);
  assert.match(html, /if\(!card\.querySelector\('\[data-mt5-connector-token\]'\)\)/);
  assert.match(html, /if\(!b\)\{/);
});
