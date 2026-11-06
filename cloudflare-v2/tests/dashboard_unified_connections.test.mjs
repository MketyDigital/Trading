import test from 'node:test';
import assert from 'node:assert/strict';
import { withUnifiedTradingConnections } from '../src/dashboard_unified_connections.js';

test('unified trading account dashboard script parses and exposes owner-only risk controls', () => {
  const html = withUnifiedTradingConnections('<main id="accountRows"></main>');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'dashboard script is present');
  assert.doesNotThrow(() => new Function(match[1]));
  assert.match(match[1], /riskPolicyEditable/);
  assert.match(match[1], /Only the workspace owner can change risk settings/);
  assert.match(match[1], /fixed_cash/);
  assert.match(match[1], /minimumVolumeRiskTolerancePercent/);
});
