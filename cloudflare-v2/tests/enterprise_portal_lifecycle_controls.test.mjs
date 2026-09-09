import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';

test('enterprise portal exposes source lifecycle controls backed by existing admin APIs', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /data-source-enable/);
  assert.match(html, /data-source-disable/);
  assert.match(html, /data-source-default/);
  assert.match(html, /\/api\/v1\/admin\/sources\/.*\/enable/);
  assert.match(html, /\/api\/v1\/admin\/sources\/.*\/disable/);
  assert.match(html, /\/api\/v1\/admin\/sources\/.*\/default/);
});

test('enterprise portal exposes safe broker account lifecycle controls without auto-enabling execution', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /data-account-active/);
  assert.match(html, /data-account-kill-switch/);
  assert.match(html, /\/api\/v1\/admin\/accounts\/.*\/active/);
  assert.match(html, /\/api\/v1\/admin\/accounts\/.*\/kill-switch/);
  assert.doesNotMatch(html, /data-account-execution-enable/);
});

test('enterprise portal exposes destination and route enable-disable controls', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /data-destination-toggle/);
  assert.match(html, /data-route-toggle/);
  assert.match(html, /\/api\/v1\/admin\/destinations\/.*\/(?:enable|disable)/);
  assert.match(html, /\/api\/v1\/admin\/routes\/.*\/(?:enable|disable)/);
});

test('enterprise portal exposes team member add, role and state controls', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /memberSubject/);
  assert.match(html, /memberRole/);
  assert.match(html, /createMemberBtn/);
  assert.match(html, /data-member-role/);
  assert.match(html, /data-member-toggle/);
  assert.match(html, /\/api\/v1\/admin\/members/);
});
