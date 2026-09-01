import test from 'node:test';
import assert from 'node:assert/strict';
import { runMT5DemoCommand } from '../src/testing/mt5_demo_runner.js';

test('MT5 runner builds persistent dependencies and emits sanitized probe result by default', async () => {
  const lines = [];
  let dependencyCalls = 0;
  let acceptanceCalls = 0;

  const result = await runMT5DemoCommand({
    env: {
      SUPABASE_URL: 'https://secret-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret-never-print',
      TRADING_WORKSPACE_ID: 'workspace-1',
      MT5_BRIDGE_URL: 'https://bridge-secret.example.test',
      MT5_BRIDGE_SECRET: 'bridge-secret-never-print',
      MT5_ACCOUNT_ID: '12345',
      MT5_EXPECTED_DEMO_SERVER: 'Broker-Demo',
    },
    logger: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    dependencyBuilder: ({ env }) => {
      dependencyCalls += 1;
      assert.equal(env.TRADING_WORKSPACE_ID, 'workspace-1');
      return { deliveryStore: { name: 'persistent' } };
    },
    acceptanceRunner: async ({ env, deliveryStore }) => {
      acceptanceCalls += 1;
      assert.equal(env.MT5_DEMO_ACCEPTANCE_MODE, undefined);
      assert.equal(deliveryStore.name, 'persistent');
      return { mode: 'probe', result: { ready: true, nested: { bridgeSecret: '[REDACTED]' } } };
    },
  });

  assert.equal(dependencyCalls, 1);
  assert.equal(acceptanceCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.output.mode, 'probe');
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /secret-project|service-secret-never-print|bridge-secret-never-print/i);
});

test('MT5 runner rejects incomplete server config by variable name only and never builds dependencies', async () => {
  const lines = [];
  let dependencyCalls = 0;

  const result = await runMT5DemoCommand({
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

test('MT5 runner lifecycle path stays behind existing explicit demo order gate', async () => {
  const lines = [];
  let acceptanceCalls = 0;

  const result = await runMT5DemoCommand({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      TRADING_WORKSPACE_ID: 'workspace-1',
      MT5_BRIDGE_URL: 'https://bridge.example.test',
      MT5_BRIDGE_SECRET: 'bridge-secret',
      MT5_ACCOUNT_ID: '12345',
      MT5_EXPECTED_DEMO_SERVER: 'Broker-Demo',
      MT5_DEMO_ACCEPTANCE_MODE: 'lifecycle',
      MT5_DEMO_ORDER_TEST: 'false',
    },
    logger: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    dependencyBuilder: () => ({ deliveryStore: {} }),
    acceptanceRunner: async () => {
      acceptanceCalls += 1;
      throw new Error('MT5 demo order test must be explicitly enabled');
    },
  });

  assert.equal(acceptanceCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(lines.join('\n'), /explicitly enabled/i);
});
