import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDashboard } from '../src/dashboard.js';

test('source lifecycle buttons use exact V1 enable and disable actions', () => {
  const html = renderDashboard({});
  assert.equal(html.includes("'/api/v1/admin/sources/'+encodeURIComponent(b.dataset.id)+'/state'"), false);
  assert.match(html, /\/api\/v1\/admin\/sources\/['"]?\+encodeURIComponent\(b\.dataset\.id\)\+['"]?\/['"]?\+\(b\.dataset\.enabled===['"]true['"]\?['"]enable['"]:['"]disable['"]\)/);
});

test('dashboard exposes only backend-supported broker account lifecycle actions', () => {
  const html = renderDashboard({});
  assert.match(html, /\/active/);
  assert.match(html, /\/execution/);
  assert.match(html, /\/kill-switch/);
  assert.equal(html.includes('/api/v1/admin/accounts/'+"${id}"+'/delete'), false);
});

test('dashboard uses exact member and hostname action families', () => {
  const html = renderDashboard({});
  assert.match(html, /\/members\/['"]?\+b\.dataset\.subject\+['"]?\/role/);
  assert.match(html, /\?['"]enable['"]:['"]disable['"]/);
  assert.match(html, /\/hostnames\/['"]?\+encodeURIComponent\(b\.dataset\.id\)\+['"]?\/verify/);
});

test('source provider selection owns the backend-defined source family instead of free-form family input', () => {
  const html = renderDashboard({});
  assert.equal(html.includes('id="sourceFamily"'), false);
  assert.match(html, /cloudflare_container_mtproto/);
  assert.match(html, /tradingview_webhook/);
  assert.match(html, /mt5_source_bridge/);
  assert.match(html, /ctrader_source/);
  assert.match(html, /custom_signed_api/);
});
