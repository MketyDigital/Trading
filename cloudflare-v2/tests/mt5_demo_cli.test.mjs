import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMT5DemoAcceptanceMode,
  runMT5DemoAcceptanceFromEnv,
} from '../src/testing/mt5_demo_cli.js';

test('MT5 demo CLI defaults to probe-only and rejects unsupported modes', () => {
  assert.equal(resolveMT5DemoAcceptanceMode({}), 'probe');
  assert.equal(resolveMT5DemoAcceptanceMode({ MT5_DEMO_ACCEPTANCE_MODE: 'lifecycle' }), 'lifecycle');
  assert.throws(() => resolveMT5DemoAcceptanceMode({ MT5_DEMO_ACCEPTANCE_MODE: 'live' }), /unsupported/i);
});

test('MT5 probe mode never invokes lifecycle even when demo order gate is present', async () => {
  let probeCalls = 0;
  let lifecycleCalls = 0;
  const result = await runMT5DemoAcceptanceFromEnv({
    env: { MT5_DEMO_ORDER_TEST: 'true' },
    probeFn: async () => { probeCalls += 1; return { ready: true, account: { login: '1001' } }; },
    lifecycleFn: async () => { lifecycleCalls += 1; return {}; },
  });
  assert.equal(result.mode, 'probe');
  assert.equal(probeCalls, 1);
  assert.equal(lifecycleCalls, 0);
});

test('MT5 lifecycle mode invokes lifecycle path and sanitizes secret-looking result fields', async () => {
  let lifecycleCalls = 0;
  const result = await runMT5DemoAcceptanceFromEnv({
    env: { MT5_DEMO_ACCEPTANCE_MODE: 'lifecycle', MT5_DEMO_ORDER_TEST: 'true' },
    probeFn: async () => { throw new Error('probe-only path should not be called directly'); },
    lifecycleFn: async () => {
      lifecycleCalls += 1;
      return { environment: 'demo', positionId: '9001', accessToken: 'never-print', nested: { password: 'never-print-2' } };
    },
  });
  assert.equal(lifecycleCalls, 1);
  assert.equal(result.mode, 'lifecycle');
  assert.equal(result.result.accessToken, '[REDACTED]');
  assert.equal(result.result.nested.password, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(result), /never-print/);
});
