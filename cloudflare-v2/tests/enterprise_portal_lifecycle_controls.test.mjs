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

test('team management is explicitly gated when central authentication is not configured', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /Team access requires central authentication/i);
  assert.match(html, /data-team-central-auth-required/);
  assert.doesNotMatch(html, /createMemberBtn/);
});

test('mobile connection cards allow wide lifecycle tables to scroll without widening the page', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /\.grid>\*\{min-width:0\}/);
  assert.match(html, /\.grid3>\*\{min-width:0\}/);
  assert.match(html, /\.table-wrap\{[^}]*max-width:100%[^}]*overflow:auto/);
});
