import test from 'node:test';
import assert from 'node:assert/strict';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';

test('unified trading account dashboard script parses and exposes owner-only risk controls', () => {
  const html = withUnifiedTradingConnections('<html><body><main id="accountRows"></main></body></html>');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'dashboard script is present');
  assert.doesNotThrow(() => new Function(match[1]));
  assert.match(match[1], /riskPolicyEditable/);
  assert.match(match[1], /Only the workspace owner can change risk settings/);
  assert.match(match[1], /fixed_cash/);
  assert.match(match[1], /minimumVolumeRiskTolerancePercent/);
  assert.match(match[1], /data-account-sizing-toggle/);
  assert.match(match[1], /data-account-sizing-editor/);
  assert.match(match[1], /data-sizing-type/);
  assert.match(match[1], /data-risk-mode/);
  assert.match(match[1], /data-account-sizing-save/);
  assert.match(match[1], /Fixed cash risk per TP leg/);
  assert.match(match[1], /Configure sizing/);
  assert.match(match[1], /\/api\/v1\/admin\/connections\/accounts\//);
  assert.match(match[1], /Use Configure sizing to change its lot\/risk method/);
});
