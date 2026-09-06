import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDashboard } from '../src/dashboard.js';

test('operations view reads canonical V1 operational state and supports event audit drill-down', () => {
  const html = renderDashboard({});

  assert.match(html, /\/api\/v1\/admin\/operations/);
  assert.match(html, /\/api\/v1\/admin\/events\/['"]?\+encodeURIComponent\(id\)\+['"]?\/audit/);
  assert.match(html, /Operations & audit/);
  assert.match(html, /Audit event ID/);
});

test('risk and execution controls use only supported account lifecycle endpoints', () => {
  const html = renderDashboard({});

  assert.match(html, /\/accounts\/['"]?\+encodeURIComponent\(b\.dataset\.id\)\+['"]?\/execution/);
  assert.match(html, /\/accounts\/['"]?\+encodeURIComponent\(b\.dataset\.id\)\+['"]?\/kill-switch/);
  assert.match(html, /Master broker execution fuse/);
  assert.equal(html.includes('/api/v1/admin/accounts/'+"${id}"+'/risk'), false);
});

test('settings surface is truthful and read-only for deployment-owned security configuration', () => {
  const html = renderDashboard({});

  assert.match(html, /Deployment-owned security\/runtime settings are intentionally read-only/);
  assert.match(html, /issuer\/audience\/JWKS/);
  assert.match(html, /Browser callers cannot select simulation transport/);
  assert.equal(html.includes('AI settings saved'), false);
  assert.equal(html.includes('data-action="save-settings"'), false);
});
