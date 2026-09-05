import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCTraderDemoCommandEnvironment,
  buildCTraderDemoCommandDependencies,
} from '../src/testing/ctrader_demo_command.js';
import { runCTraderDemoCommand } from '../src/testing/ctrader_demo_runner.js';

test('cTrader demo command reports required server-side config names only', () => {
  const result = validateCTraderDemoCommandEnvironment({
    SUPABASE_URL: 'https://secret-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-secret-never-print',
    TRADING_WORKSPACE_ID: '',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['TRADING_WORKSPACE_ID']);
  assert.doesNotMatch(JSON.stringify(result), /secret-project|service-secret-never-print/i);
});

test('cTrader demo command accepts the normalized staging SUPABASE_SERVICE_ROLE alias', () => {
  const result = validateCTraderDemoCommandEnvironment({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-secret',
    TRADING_WORKSPACE_ID: 'workspace-123',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('dependency builder creates persistent cTrader demo delivery store scoped to workspace/account', () => {
  const calls = [];
  const fakeClient = { from() {} };
  const deps = buildCTraderDemoCommandDependencies({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE: 'service-secret',
      TRADING_WORKSPACE_ID: 'workspace-123',
      CTRADER_ACCOUNT_ID: '77',
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
  assert.equal(deps.deliveryStore.destinationType, 'ctrader');
  assert.equal(deps.deliveryStore.destinationRef, 'demo:77');
});

test('dependency builder fails before client creation when command environment is incomplete', () => {
  let calls = 0;
  assert.throws(() => buildCTraderDemoCommandDependencies({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE: 'service-secret',
      TRADING_WORKSPACE_ID: '',
      CTRADER_ACCOUNT_ID: '77',
    },
    createClientFn: () => { calls += 1; return { from() {} }; },
  }), /TRADING_WORKSPACE_ID/);
  assert.equal(calls, 0);
});

test('cTrader probe mode does not require Supabase delivery-store configuration', async () => {
  const logs = [];
  const result = await runCTraderDemoCommand({
    env: {
      CTRADER_DEMO_ACCEPTANCE_MODE: 'probe',
      CTRADER_CLIENT_ID: 'client-id',
      CTRADER_CLIENT_SECRET: 'client-secret',
      CTRADER_ACCESS_TOKEN: 'access-token',
      CTRADER_ACCOUNT_ID: '77',
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
