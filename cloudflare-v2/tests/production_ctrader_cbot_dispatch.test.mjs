import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function unexpectedSupabase() {
  return { from() { throw new Error('unexpected database query'); } };
}

function cbotAction(accountId = 'acct-cbot-1') {
  return {
    type: 'OPEN_POSITION',
    symbol: 'XAUUSD',
    side: 'BUY',
    lots: 0.01,
    idempotencyKey: `event-1:${accountId}:1`,
  };
}

test('cTrader cBot destination uses its server-side gateway credentials instead of Open API runtime', async () => {
  const seen = {};
  const account = {
    id: 'acct-cbot-1',
    workspace_id: 'ws-a',
    platform: 'ctrader',
    provider_mode: 'ctrader_cbot',
    account_id: '987654',
    environment: 'demo',
    server_name: null,
    provider_config: { status: 'connected' },
    credential_ciphertext: 'encrypted-cbot-envelope',
    is_active: true,
    execution_enabled: true,
    safety_policy: { killSwitch: false },
  };

  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master-key' },
    supabase: unexpectedSupabase(),
    workspaceId: 'ws-a',
    tradingEventId: 'event-1',
  }, {
    decryptCredentialsFn: async (kind, ciphertext, masterKey) => {
      seen.decrypt = { kind, ciphertext, masterKey };
      return {
        gatewayUrl: 'https://cbot-gateway.example',
        controlSecret: 'gateway-control-secret',
      };
    },
    deliveryStoreFactory: (_supabase, options) => {
      seen.store = options;
      return { reserve() {}, complete() {}, fail() {} };
    },
    ctraderCbotExecutor: async (action, options) => {
      seen.action = action;
      seen.options = options;
      return { brokerPositionId: 'cbot-position-1' };
    },
    ctraderRuntimeFactory: async () => {
      throw new Error('Open API runtime must not be constructed for ctrader_cbot');
    },
  });

  const action = cbotAction();
  const result = await deps.dispatchAction({
    workspaceId: 'ws-a',
    groupId: 'group-1',
    account,
    action,
  });

  assert.equal(result.brokerPositionId, 'cbot-position-1');
  assert.deepEqual(seen.decrypt, {
    kind: 'ctrader_cbot',
    ciphertext: 'encrypted-cbot-envelope',
    masterKey: 'master-key',
  });
  assert.equal(seen.options.workspaceId, 'ws-a');
  assert.equal(seen.options.accountRowId, 'acct-cbot-1');
  assert.equal(seen.options.gatewayUrl, 'https://cbot-gateway.example');
  assert.equal(seen.options.controlSecret, 'gateway-control-secret');
  assert.equal(seen.options.deliveryStore != null, true);
  assert.equal(seen.options.fetchFn, fetch);
  assert.deepEqual(seen.action, action);
  assert.deepEqual(seen.store, {
    workspaceId: 'ws-a',
    destinationType: 'ctrader',
    destinationRef: 'trade-account:acct-cbot-1',
    tradingEventId: 'event-1',
  });
});

test('cTrader cBot dispatch fails closed before credentials or gateway when broker account is still pending', async () => {
  let decryptCalls = 0;
  let executorCalls = 0;
  const account = {
    id: 'acct-cbot-pending',
    workspace_id: 'ws-a',
    platform: 'ctrader',
    provider_mode: 'ctrader_cbot',
    account_id: 'pending:abc123',
    environment: 'demo',
    provider_config: { status: 'connected' },
    credential_ciphertext: 'encrypted-cbot-envelope',
    is_active: true,
    execution_enabled: true,
    safety_policy: { killSwitch: false },
  };
  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master-key' },
    supabase: unexpectedSupabase(),
    workspaceId: 'ws-a',
    tradingEventId: 'event-1',
  }, {
    decryptCredentialsFn: async () => {
      decryptCalls += 1;
      return { gatewayUrl: 'https://cbot-gateway.example', controlSecret: 'secret' };
    },
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    ctraderCbotExecutor: async () => {
      executorCalls += 1;
      return { brokerPositionId: 'should-not-run' };
    },
  });

  await assert.rejects(
    deps.dispatchAction({ workspaceId: 'ws-a', groupId: 'group-1', account, action: cbotAction(account.id) }),
    (error) => error?.code === 'CTRADER_CBOT_NOT_CONNECTED',
  );
  assert.equal(decryptCalls, 0);
  assert.equal(executorCalls, 0);
});

test('cTrader cBot dispatch fails closed before credentials or gateway when provider status is not connected', async () => {
  let decryptCalls = 0;
  let executorCalls = 0;
  const account = {
    id: 'acct-cbot-awaiting',
    workspace_id: 'ws-a',
    platform: 'ctrader',
    provider_mode: 'ctrader_cbot',
    account_id: '987654',
    environment: 'demo',
    provider_config: { status: 'awaiting_cbot' },
    credential_ciphertext: 'encrypted-cbot-envelope',
    is_active: true,
    execution_enabled: true,
    safety_policy: { killSwitch: false },
  };
  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master-key' },
    supabase: unexpectedSupabase(),
    workspaceId: 'ws-a',
    tradingEventId: 'event-1',
  }, {
    decryptCredentialsFn: async () => {
      decryptCalls += 1;
      return { gatewayUrl: 'https://cbot-gateway.example', controlSecret: 'secret' };
    },
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    ctraderCbotExecutor: async () => {
      executorCalls += 1;
      return { brokerPositionId: 'should-not-run' };
    },
  });

  await assert.rejects(
    deps.dispatchAction({ workspaceId: 'ws-a', groupId: 'group-1', account, action: cbotAction(account.id) }),
    (error) => error?.code === 'CTRADER_CBOT_NOT_CONNECTED',
  );
  assert.equal(decryptCalls, 0);
  assert.equal(executorCalls, 0);
});
