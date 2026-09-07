import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function supabaseStub() {
  return { from() { throw new Error('unexpected database query'); } };
}

function deliveryStoreFactory() {
  return { reserve() {}, complete() {}, fail() {} };
}

test('MT5 production dispatch uses the exact account credential envelope instead of Worker-global bridge credentials', async () => {
  const seen = {};
  const account = {
    id: 'acct-mt5-a',
    workspace_id: 'ws-a',
    platform: 'mt5',
    account_id: '90001',
    server_name: 'Broker-Live',
    credential_ciphertext: 'synthetic-mt5-envelope',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };

  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'synthetic-master-key' },
    supabase: supabaseStub(),
    workspaceId: 'ws-a',
    tradingEventId: 'event-a',
  }, {
    decryptCredentialsFn: async (kind, ciphertext, masterKey) => {
      seen.decrypt = { kind, ciphertext, masterKey };
      return {
        bridgeUrl: 'https://account-bridge.example',
        bridgeSecret: 'synthetic-bridge-secret',
      };
    },
    deliveryStoreFactory,
    mt5ContextLoader: async (options) => {
      seen.context = options;
      return {
        commandUrl: 'https://account-bridge.example/v1/command',
        catalog: [{ canonical: 'XAUUSD', platform: 'mt5', platformSymbol: 'XAUUSD' }],
      };
    },
    mt5Executor: async (_action, options) => {
      seen.executor = options;
      return { brokerPositionId: 'position-a' };
    },
  });

  const result = await deps.dispatchAction({
    workspaceId: 'ws-a',
    account,
    action: { type: 'OPEN_POSITION', symbol: 'XAUUSD', idempotencyKey: 'event-a:acct-mt5-a:1' },
  });

  assert.equal(result.brokerPositionId, 'position-a');
  assert.deepEqual(seen.decrypt, {
    kind: 'mt5',
    ciphertext: 'synthetic-mt5-envelope',
    masterKey: 'synthetic-master-key',
  });
  assert.equal(seen.context.bridgeUrl, 'https://account-bridge.example');
  assert.equal(seen.context.bridgeSecret, 'synthetic-bridge-secret');
  assert.equal(seen.executor.bridgeSecret, 'synthetic-bridge-secret');
});

test('cTrader production dispatch uses the exact account credential envelope instead of Worker-global client credentials or legacy token column', async () => {
  const seen = {};
  const account = {
    id: 'acct-ct-a',
    workspace_id: 'ws-a',
    platform: 'ctrader',
    account_id: '123456',
    server_name: 'demo',
    credential_ciphertext: 'synthetic-ctrader-envelope',
    api_token_encrypted: 'legacy-token-must-not-be-used',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };

  const deps = createProductionExecutionDependencies({
    env: {
      TRADING_MASTER_KEY: 'synthetic-master-key',
      CTRADER_LIVE_TRADING_ENABLED: 'false',
    },
    supabase: supabaseStub(),
    workspaceId: 'ws-a',
    tradingEventId: 'event-a',
  }, {
    decryptCredentialsFn: async (kind, ciphertext, masterKey) => {
      seen.decrypt = { kind, ciphertext, masterKey };
      return {
        clientId: 'synthetic-client-id',
        clientSecret: 'synthetic-client-secret',
        accessToken: 'synthetic-access-token',
        refreshToken: 'synthetic-refresh-token',
      };
    },
    deliveryStoreFactory,
    ctraderRuntimeFactory: async (options) => {
      seen.runtime = options;
      return {
        async execute() { return { brokerPositionId: 'ct-position-a' }; },
        async close() {},
      };
    },
  });

  const result = await deps.dispatchAction({
    workspaceId: 'ws-a',
    account,
    action: { type: 'OPEN_POSITION', symbol: 'XAUUSD', idempotencyKey: 'event-a:acct-ct-a:1' },
  });

  assert.equal(result.brokerPositionId, 'ct-position-a');
  assert.deepEqual(seen.decrypt, {
    kind: 'ctrader',
    ciphertext: 'synthetic-ctrader-envelope',
    masterKey: 'synthetic-master-key',
  });
  assert.equal(seen.runtime.clientId, 'synthetic-client-id');
  assert.equal(seen.runtime.clientSecret, 'synthetic-client-secret');
  assert.equal(seen.runtime.accessToken, 'synthetic-access-token');
  assert.equal(seen.runtime.accountId, 123456);
});
