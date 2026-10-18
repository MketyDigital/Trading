import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMT5DemoCommandEnvironment,
  buildMT5DemoCommandDependencies,
} from '../src/testing/mt5_demo_command.js';
import { runMT5DemoCommand } from '../src/testing/mt5_demo_runner.js';

test('MT5 demo command reports required Trading storage config names only', () => {
  const result = validateMT5DemoCommandEnvironment({
    TRADING_PG_STAGING_DATABASE_URL: 'postgres://secret',
    TRADING_MASTER_KEY: 'master-secret',
    TRADING_WORKSPACE_ID: '',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['TRADING_STORAGE_AUTHORITY=postgres', 'TRADING_WORKSPACE_ID', 'TRADING_STORAGE_AUTHORITY_EPOCH']);
  assert.doesNotMatch(JSON.stringify(result), /postgres:\/\/secret|master-secret/i);
});

test('MT5 demo command accepts the existing Trading PostgreSQL staging config', () => {
  const result = validateMT5DemoCommandEnvironment({
    TRADING_STORAGE_AUTHORITY: 'postgres',
    TRADING_STORAGE_AUTHORITY_EPOCH: '1',
    TRADING_PG_STAGING_DATABASE_URL: 'postgres://secret',
    TRADING_MASTER_KEY: 'master-secret',
    TRADING_WORKSPACE_ID: 'workspace-123',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test('dependency builder creates PostgreSQL MT5 demo delivery store scoped to workspace/account', async () => {
  const calls = [];
  const fakeStore = { find() {} };
  const deps = await buildMT5DemoCommandDependencies({
    env: {
      TRADING_STORAGE_AUTHORITY: 'postgres',
      TRADING_STORAGE_AUTHORITY_EPOCH: '1',
      TRADING_PG_STAGING_DATABASE_URL: 'postgres://secret',
      TRADING_MASTER_KEY: 'master-secret',
      TRADING_WORKSPACE_ID: 'workspace-123',
      MT5_ACCOUNT_ID: '1001',
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
  assert.deepEqual(calls[1], { workspaceId: 'workspace-123', destinationType: 'mt5', destinationRef: 'demo:1001' });
  assert.equal(deps.deliveryStore, fakeStore);
  await deps.close();
  assert.equal(calls[2], 'closed');
});

test('dependency builder fails before runtime creation when command environment is incomplete', async () => {
  let calls = 0;
  await assert.rejects(buildMT5DemoCommandDependencies({
    env: {
      TRADING_WORKSPACE_ID: '',
      MT5_ACCOUNT_ID: '1001',
    },
    runtimeFactory: () => { calls += 1; return {}; },
  }), /TRADING_WORKSPACE_ID/);
  assert.equal(calls, 0);
});

test('MT5 probe mode does not require database delivery-store configuration', async () => {
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
