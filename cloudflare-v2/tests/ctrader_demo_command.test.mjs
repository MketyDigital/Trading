import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCTraderDemoCommandEnvironment,
  buildCTraderDemoCommandDependencies,
} from '../src/testing/ctrader_demo_command.js';

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

test('dependency builder creates persistent cTrader demo delivery store scoped to workspace/account', () => {
  const calls = [];
  const fakeClient = { from() {} };
  const deps = buildCTraderDemoCommandDependencies({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
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
      SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
      TRADING_WORKSPACE_ID: '',
      CTRADER_ACCOUNT_ID: '77',
    },
    createClientFn: () => { calls += 1; return { from() {} }; },
  }), /TRADING_WORKSPACE_ID/);
  assert.equal(calls, 0);
});
