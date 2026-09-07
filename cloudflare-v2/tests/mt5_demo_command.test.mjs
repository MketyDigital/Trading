import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMT5DemoCommandEnvironment,
  buildMT5DemoCommandDependencies,
} from '../src/testing/mt5_demo_command.js';
import { runMT5DemoCommand } from '../src/testing/mt5_demo_runner.js';

test('MT5 demo command reports required server-side config names only', () => {
  const result = validateMT5DemoCommandEnvironment({
    SUPABASE_URL: 'https://secret-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-secret-never-print',
    TRADING_WORKSPACE_ID: '',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['TRADING_WORKSPACE_ID']);
  assert.doesNotMatch(JSON.stringify(result), /secret-project|service-secret-never-print/i);
});

test('MT5 demo command accepts the normalized staging SUPABASE_SERVICE_ROLE alias', () => {
  const result = validateMT5DemoCommandEnvironment({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-secret',
    TRADING_WORKSPACE_ID: 'workspace-123',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('dependency builder creates persistent MT5 demo delivery store scoped to workspace/account', () => {
  const calls = [];
  const fakeClient = { from() {} };
  const deps = buildMT5DemoCommandDependencies({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE: 'service-secret',
      TRADING_WORKSPACE_ID: 'workspace-123',
      MT5_ACCOUNT_ID: '1001',
    },
    createClientFn: (url, key, options) => {
      calls.push({ url, key, options });
      return fakeClient;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://project.supabase.co');
  assert.equal(calls[0].key, 'service-secret');
  assert.equal(calls[0].options.auth.persistSession, false);
  assert.equal(deps.deliveryStore.workspaceId, 'workspace-123');
  assert.equal(deps.deliveryStore.destinationType, 'mt5');
  assert.equal(deps.deliveryStore.destinationRef, 'demo:1001');
});

test('dependency builder fails before client creation when command environment is incomplete', () => {
  let calls = 0;
  assert.throws(() => buildMT5DemoCommandDependencies({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE: 'service-secret',
      TRADING_WORKSPACE_ID: '',
      MT5_ACCOUNT_ID: '1001',
    },
    createClientFn: () => { calls += 1; return { from() {} }; },
  }), /TRADING_WORKSPACE_ID/);
  assert.equal(calls, 0);
});

test('MT5 probe mode does not require Supabase delivery-store configuration', async () => {
  const logs = [];
  const result = await runMT5DemoCommand({
    env: {
      MT5_DEMO_ACCEPTANCE_MODE: 'probe',
      MT5_BRIDGE_URL: 'https://bridge.example.test',
      MT5_BRIDGE_SECRET: 'bridge-secret',
      MT5_ACCOUNT_ID: '1001',
      MT5_DEMO_SERVER: 'Demo-Server',
    },
    logger: { log: (value) => logs.push(value), error: (value) => logs.push(value) },
    dependencyBuilder: () => { throw new Error('dependency builder must not run in probe mode'); },
    acceptanceRunner: async ({ deliveryStore }) => ({ mode: 'probe', deliveryStoreProvided: Boolean(deliveryStore) }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.mode, 'probe');
  assert.equal(result.output.deliveryStoreProvided, false);
});
