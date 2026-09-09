import test from 'node:test';
import assert from 'node:assert/strict';

import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';

test('enterprise portal only requests custom hostnames when the workspace is entitled', () => {
  const html = renderEnterpriseTradingPortal({
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  });

  assert.match(
    html,
    /var entitlements=session\(\)\.entitlements\|\|\{\};if\(entitlements\.customHostname\)jobs\.push\(\['hostnames','\/api\/v1\/admin\/hostnames'\]\);else state\.hostnames=\[\]/,
  );

  const initialJobs = html.match(/var jobs=\[(.*?)\];var entitlements=/s)?.[1] || '';
  assert.doesNotMatch(initialJobs, /\/api\/v1\/admin\/hostnames/);
});
