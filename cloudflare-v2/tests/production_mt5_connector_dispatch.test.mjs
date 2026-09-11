import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function unexpectedSupabase() {
  return { from() { throw new Error('unexpected database query'); } };
}

function mt5Action(accountId = 'acct-mt5-1') {
  return {
    type: 'OPEN_POSITION',
    symbol: 'GOLD',
    side: 'BUY',
    lots: 0.01,
    idempotencyKey: `event-1:${accountId}:1`,
  };
}

test('mt5_connector destination uses outbound gateway credentials and bypasses legacy HTTP bridge runtime', async () => {
  const seen = {};
  const account = {
    id: 'acct-mt5-1',
    workspace_id: 'ws-a',
    platform: 'mt5',
    provider_mode: 'mt5_connector',
    account_id: '50123456',
    environment: 'demo',
    server_name: 'Broker-Demo',
    provider_config: {
      status: 'connected',
      symbolCatalog: [{ platformSymbol: 'XAUUSD.r', canonical: 'XAUUSD', aliases: ['GOLD'], tradable: true }],
    },
    credential_ciphertext: 'encrypted-mt5-connector-envelope',
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
      return { gatewayUrl: 'https://gateway.example:25345', controlSecret: 'gateway-control-secret' };
    },
    deliveryStoreFactory: (_supabase, options) => {
      seen.store = options;
      return { reserve() {}, complete() {}, fail() {} };
    },
    mt5ConnectorExecutor: async (action, options) => {
      seen.action = action;
      seen.options = options;
      return { brokerPositionId: 'mt5-position-1' };
    },
    mt5ContextLoader: async () => {
      throw new Error('legacy MT5 HTTP bridge context must not be used for mt5_connector');
    },
    mt5Executor: async () => {
      throw new Error('legacy MT5 HTTP bridge executor must not be used for mt5_connector');
    },
  });

  const result = await deps.dispatchAction({ workspaceId: 'ws-a', groupId: 'group-1', account, action: mt5Action() });

  assert.equal(result.brokerPositionId, 'mt5-position-1');
  assert.deepEqual(seen.decrypt, {
    kind: 'mt5_connector',
    ciphertext: 'encrypted-mt5-connector-envelope',
    masterKey: 'master-key',
  });
  assert.equal(seen.options.workspaceId, 'ws-a');
  assert.equal(seen.options.accountRowId, 'acct-mt5-1');
  assert.equal(seen.options.gatewayUrl, 'https://gateway.example:25345');
  assert.equal(seen.options.controlSecret, 'gateway-control-secret');
  assert.equal(seen.options.catalog[0].platformSymbol, 'XAUUSD.r');
  assert.equal(seen.options.aliases && typeof seen.options.aliases, 'object');
  assert.deepEqual(seen.action, mt5Action());
});

test('mt5_connector dispatch fails closed before decrypt or gateway when identity is pending or status is not connected', async () => {
  for (const account of [
    { account_id: 'pending:abc', provider_config: { status: 'connected' } },
    { account_id: '50123456', provider_config: { status: 'awaiting_connector' } },
  ]) {
    let decryptCalls = 0;
    let executorCalls = 0;
    const deps = createProductionExecutionDependencies({
      env: { TRADING_MASTER_KEY: 'master-key' },
      supabase: unexpectedSupabase(),
      workspaceId: 'ws-a',
      tradingEventId: 'event-1',
    }, {
      decryptCredentialsFn: async () => { decryptCalls += 1; return {}; },
      deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
      mt5ConnectorExecutor: async () => { executorCalls += 1; return {}; },
    });
    await assert.rejects(
      deps.dispatchAction({
        workspaceId: 'ws-a', groupId: 'group-1',
        account: {
          id: 'acct-mt5-1', workspace_id: 'ws-a', platform: 'mt5', provider_mode: 'mt5_connector',
          environment: 'demo', credential_ciphertext: 'cipher', is_active: true, execution_enabled: true,
          safety_policy: { killSwitch: false }, ...account,
        },
        action: mt5Action(),
      }),
      (error) => error?.code === 'MT5_CONNECTOR_NOT_CONNECTED',
    );
    assert.equal(decryptCalls, 0);
    assert.equal(executorCalls, 0);
  }
});
