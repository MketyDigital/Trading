import test from 'node:test';
import assert from 'node:assert/strict';
import { runCTraderDemoCommand } from '../src/testing/ctrader_demo_runner.js';

test('runner builds persistent dependencies and emits sanitized probe result by default', async () => {
  const lines = [];
  let dependencyCalls = 0;
  let acceptanceCalls = 0;
  const result = await runCTraderDemoCommand({
    env: {
      SUPABASE_URL: 'https://secret-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret-never-print',
      TRADING_WORKSPACE_ID: 'workspace-1',
      CTRADER_CLIENT_ID: 'client-id',
      CTRADER_CLIENT_SECRET: 'client-secret-never-print',
      CTRADER_ACCESS_TOKEN: 'access-token-never-print',
      CTRADER_ACCOUNT_ID: '77',
    },
    logger: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    dependencyBuilder: ({ env }) => {
      dependencyCalls += 1;
      assert.equal(env.TRADING_WORKSPACE_ID, 'workspace-1');
      return { deliveryStore: { name: 'persistent' } };
    },
    acceptanceRunner: async ({ env, deliveryStore }) => {
      acceptanceCalls += 1;
      assert.equal(env.CTRADER_DEMO_ACCEPTANCE_MODE, undefined);
      assert.equal(deliveryStore.name, 'persistent');
      return { mode: 'probe', result: { ready: true, nested: { accessToken: '[REDACTED]' } } };
    },
  });

  assert.equal(dependencyCalls, 1);
  assert.equal(acceptanceCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.output.mode, 'probe');
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /secret-never-print|access-token-never-print|service-secret-never-print/i);
});

test('runner rejects incomplete server config by variable name only and never builds dependencies', async () => {
  const lines = [];
  let dependencyCalls = 0;
  const result = await runCTraderDemoCommand({
    env: {
      SUPABASE_URL: 'https://secret-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret-never-print',
      TRADING_WORKSPACE_ID: '',
    },
    logger: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    dependencyBuilder: () => { dependencyCalls += 1; return {}; },
    acceptanceRunner: async () => ({ mode: 'probe', result: { ready: true } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(dependencyCalls, 0);
  assert.match(lines.join('\n'), /TRADING_WORKSPACE_ID/);
  assert.doesNotMatch(lines.join('\n'), /secret-project|service-secret-never-print/i);
});

test('runner lifecycle path stays behind existing explicit demo order gate', async () => {
  const lines = [];
  let acceptanceCalls = 0;
  const result = await runCTraderDemoCommand({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      TRADING_WORKSPACE_ID: 'workspace-1',
      CTRADER_CLIENT_ID: 'id',
      CTRADER_CLIENT_SECRET: 'secret',
      CTRADER_ACCESS_TOKEN: 'token',
      CTRADER_ACCOUNT_ID: '77',
      CTRADER_DEMO_ACCEPTANCE_MODE: 'lifecycle',
      CTRADER_DEMO_ORDER_TEST: 'false',
    },
    logger: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    dependencyBuilder: () => ({ deliveryStore: {} }),
    acceptanceRunner: async () => {
      acceptanceCalls += 1;
      throw new Error('cTrader demo order test must be explicitly enabled');
    },
  });

  assert.equal(acceptanceCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(lines.join('\n'), /explicitly enabled/i);
});
