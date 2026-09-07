import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDashboard } from '../src/dashboard.js';

test('real dashboard does not call retired Trading admin endpoints', () => {
  const html = renderDashboard({});
  const retired = [
    '/api/admin/data/proxy',
    '/api/admin/bot/authorize',
    '/api/admin/bank/decision',
    '/api/admin/listener/',
    '/api/webhook/process_signal',
  ];
  for (const endpoint of retired) {
    assert.equal(html.includes(endpoint), false, `dashboard still references retired endpoint ${endpoint}`);
  }
});

test('real dashboard uses the V1 admin contract with workspace and bearer headers', () => {
  const html = renderDashboard({});
  assert.match(html, /\/api\/v1\/admin\/workspace/);
  assert.match(html, /\/api\/v1\/admin\/members/);
  assert.match(html, /\/api\/v1\/admin\/sources/);
  assert.match(html, /\/api\/v1\/admin\/accounts/);
  assert.match(html, /\/api\/v1\/admin\/hostnames/);
  assert.match(html, /X-Mkety-Workspace-Id/);
  assert.match(html, /Authorization/);
  assert.match(html, /Bearer/);
});

test('settings UI never reports a fake successful save', () => {
  const html = renderDashboard({});
  assert.equal(html.includes('Master Prompt Instructions simulated save successful'), false);
});
