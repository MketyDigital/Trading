import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCTraderDemoCommandEnvironment,
  buildCTraderDemoCommandDependencies,
} from '../src/testing/ctrader_demo_command.js';
import { runCTraderDemoCommand } from '../src/testing/ctrader_demo_runner.js';

test('cTrader demo command reports required Trading storage config names only', () => {
  const result = validateCTraderDemoCommandEnvironment({
    TRADING_PG_STAGING_DATABASE_URL: 'postgres://secret',
    TRADING_MASTER_KEY: 'master-secret',
    TRADING_WORKSPACE_ID: '',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['TRADING_STORAGE_AUTHORITY=postgres', 'TRADING_WORKSPACE_ID', 'TRADING_STORAGE_AUTHORITY_EPOCH']);
  assert.doesNotMatch(JSON.stringify(result), /postgres:\/\/secret|master-secret/i);
});

test('cTrader demo command accepts the existing Trading PostgreSQL staging config', () => {
  const result = validateCTraderDemoCommandEnvironment({
    TRADING_STORAGE_AUTHORITY: 'postgres',
    TRADING_STORAGE_AUTHORITY_EPOCH: '1',
    TRADING_PG_STAGING_DATABASE_URL: 'postgres://secret',
    TRADING_MASTER_KEY: 'master-secret',
    TRADING_WORKSPACE_ID: 'workspace-123',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('dependency builder creates PostgreSQL cTrader demo delivery store scoped to workspace/account', async () => {
  const calls = [];
  const fakeStore = { find() {} };
  const deps = await buildCTraderDemoCommandDependencies({
    env: {
      TRADING_STORAGE_AUTHORITY: 'postgres',
      TRADING_STORAGE_AUTHORITY_EPOCH: '1',
      TRADING_PG_STAGING_DATABASE_URL: 'postgres://secret',
      TRADING_MASTER_KEY: 'master-secret',
      TRADING_WORKSPACE_ID: 'workspace-123',
      CTRADER_ACCOUNT_ID: '77',
    },
    runtimeFactory: async (env) => {
      calls.push(env);
      return {
        delivery: (options) => { calls.push(options); return fakeStore; },
        close() { calls.push('closed'); },
      };
    },
  });

  assert.equal(calls[0].TRADING_STORAGE_AUTHORITY, 'postgres');
  assert.deepEqual(calls[0].TRADING_PG, { connectionString: 'postgres://secret' });
  assert.deepEqual(calls[1], { workspaceId: 'workspace-123', destinationType: 'ctrader', destinationRef: 'demo:77' });
  assert.equal(deps.deliveryStore, fakeStore);
  await deps.close();
  assert.equal(calls[2], 'closed');
});

test('dependency builder fails before runtime creation when command environment is incomplete', async () => {
  let calls = 0;
  await assert.rejects(buildCTraderDemoCommandDependencies({
    env: {
      TRADING_WORKSPACE_ID: '',
      CTRADER_ACCOUNT_ID: '77',
    },
    runtimeFactory: () => { calls += 1; return {}; },
  }), /TRADING_WORKSPACE_ID/);
  assert.equal(calls, 0);
});

test('cTrader probe mode does not require database delivery-store configuration', async () => {
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
