import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCTraderDemoAcceptanceMode,
  runCTraderDemoAcceptanceFromEnv,
} from '../src/testing/ctrader_demo_cli.js';

test('cTrader demo CLI defaults to probe-only and rejects unsupported modes', () => {
  assert.equal(resolveCTraderDemoAcceptanceMode({}), 'probe');
  assert.equal(resolveCTraderDemoAcceptanceMode({ CTRADER_DEMO_ACCEPTANCE_MODE: 'probe' }), 'probe');
  assert.equal(resolveCTraderDemoAcceptanceMode({ CTRADER_DEMO_ACCEPTANCE_MODE: 'lifecycle' }), 'lifecycle');
  assert.throws(
    () => resolveCTraderDemoAcceptanceMode({ CTRADER_DEMO_ACCEPTANCE_MODE: 'live' }),
    /probe or lifecycle/i,
  );
});

test('probe mode never invokes order lifecycle even when demo order gate is present', async () => {
  let probeCalls = 0;
  let lifecycleCalls = 0;
  const result = await runCTraderDemoAcceptanceFromEnv({
    env: {
      CTRADER_DEMO_ACCEPTANCE_MODE: 'probe',
      CTRADER_DEMO_ORDER_TEST: 'true',
      CTRADER_CLIENT_SECRET: 'secret-never-print',
      CTRADER_ACCESS_TOKEN: 'token-never-print',
    },
    probe: async () => {
      probeCalls += 1;
      return { ready: true, quote: { bid: 2500.1, ask: 2500.2 } };
    },
    lifecycle: async () => {
      lifecycleCalls += 1;
      return { status: 'closed' };
    },
  });

  assert.equal(probeCalls, 1);
  assert.equal(lifecycleCalls, 0);
  assert.equal(result.mode, 'probe');
  assert.equal(result.result.ready, true);
  assert.doesNotMatch(JSON.stringify(result), /secret-never-print|token-never-print/);
});

test('lifecycle mode invokes demo lifecycle only and sanitizes secret-looking result fields', async () => {
  let probeCalls = 0;
  let lifecycleCalls = 0;
  const result = await runCTraderDemoAcceptanceFromEnv({
    env: {
      CTRADER_DEMO_ACCEPTANCE_MODE: 'lifecycle',
      CTRADER_DEMO_ORDER_TEST: 'true',
      CTRADER_CLIENT_SECRET: 'secret-never-print',
      CTRADER_ACCESS_TOKEN: 'token-never-print',
    },
    probe: async () => {
      probeCalls += 1;
      return { ready: true };
    },
    lifecycle: async () => {
      lifecycleCalls += 1;
      return {
        environment: 'demo',
        status: 'closed',
        clientSecret: 'response-secret',
        nested: { accessToken: 'response-token', positionId: '12345' },
      };
    },
  });

  assert.equal(probeCalls, 0);
  assert.equal(lifecycleCalls, 1);
  assert.equal(result.mode, 'lifecycle');
  assert.equal(result.result.environment, 'demo');
  assert.equal(result.result.status, 'closed');
  assert.equal(result.result.nested.positionId, '12345');
  assert.equal(result.result.clientSecret, '[REDACTED]');
  assert.equal(result.result.nested.accessToken, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(result), /response-secret|response-token|secret-never-print|token-never-print/);
});
