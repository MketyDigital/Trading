import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDashboard } from '../src/dashboard.js';

test('sources expose credential replacement and default selection through exact V1 routes', () => {
  const html = renderDashboard({});
  assert.match(html, /data-action=["']source-credentials["']/);
  assert.match(html, /data-action=["']source-default["']/);
  assert.match(html, /\/api\/v1\/admin\/sources\/['"]?\+encodeURIComponent\(b\.dataset\.id\)\+['"]?\/credentials/);
  assert.match(html, /\/api\/v1\/admin\/sources\/['"]?\+encodeURIComponent\(b\.dataset\.id\)\+['"]?\/default/);
});

test('broker accounts expose credential replacement through the supported V1 contract', () => {
  const html = renderDashboard({});
  assert.match(html, /data-action=["']account-credentials["']/);
  assert.match(html, /\/api\/v1\/admin\/accounts\/['"]?\+encodeURIComponent\(b\.dataset\.id\)\+['"]?\/credentials/);
});

test('lifecycle mutations refresh canonical server state instead of mutating browser rows optimistically', () => {
  const html = renderDashboard({});
  assert.match(html, /source-credentials[\s\S]*refreshSources\(\)/);
  assert.match(html, /source-default[\s\S]*refreshSources\(\)/);
  assert.match(html, /account-credentials[\s\S]*refreshAccounts\(\)/);
});
