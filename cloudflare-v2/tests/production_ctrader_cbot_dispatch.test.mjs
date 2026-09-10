import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function unexpectedSupabase() {
  return { from() { throw new Error('unexpected database query'); } };
}

function connectedAccount(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function action() {
  return {
    type: 'OPEN_POSITION',
    symbol: 'XAUUSD',
    side: 'BUY',
    lots: 0.01,
    idempotencyKey: 'event-1:acct-cbot-1:1',
  };
}

test('cTrader cBot destination uses its server-side gateway credentials instead of Open API runtime', async () => {
  const seen = {};
  const account = connectedAccount();

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
    ctraderCbotExecutor: async (canonicalAction, options) => {
      seen.action = canonicalAction;
      seen.options = options;
      return { brokerPositionId: 'cbot-position-1' };
    },
    ctraderRuntimeFactory: async () => {
      throw new Error('Open API runtime must not be constructed for ctrader_cbot');
    },
  });

  const canonicalAction = action();
  const result = await deps.dispatchAction({
    workspaceId: 'ws-a',
    groupId: 'group-1',
    account,
    action: canonicalAction,
  });

  assert.equal(result.brokerPositionId, 'cbot-position-1');
  assert.deepEqual(seen.decrypt, {
    kind: 'ctrader_cbot',
    ciphertext: 'encrypted-cbot-envelope',
    masterKey: 'master-key',
  });
  assert.equal(seen.options.workspaceId, 'ws-a');
  assert.equal(seen.options.accountRowId, 'acct-cbot-1');
  assert.equal(seen.options.brokerAccountId, '987654');
  assert.equal(seen.options.gatewayUrl, 'https://cbot-gateway.example');
  assert.equal(seen.options.controlSecret, 'gateway-control-secret');
  assert.equal(seen.options.deliveryStore != null, true);
  assert.equal(seen.options.fetchFn, fetch);
  assert.deepEqual(seen.action, canonicalAction);
  assert.deepEqual(seen.store, {
    workspaceId: 'ws-a',
    destinationType: 'ctrader',
    destinationRef: 'trade-account:acct-cbot-1',
    tradingEventId: 'event-1',
  });
});

for (const [name, account] of [
  ['pending broker identity', connectedAccount({ account_id: 'pending:abc' })],
  ['unsynced provider status', connectedAccount({ provider_config: { status: 'awaiting_cbot' } })],
]) {
  test(`cTrader cBot destination fails closed for ${name}`, async () => {
    let gatewayCalled = false;
    const deps = createProductionExecutionDependencies({
      env: { TRADING_MASTER_KEY: 'master-key' },
      supabase: unexpectedSupabase(),
      workspaceId: 'ws-a',
      tradingEventId: 'event-1',
    }, {
      decryptCredentialsFn: async () => {
        throw new Error('credentials must not be decrypted before connection validation');
      },
      deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
      ctraderCbotExecutor: async () => {
        gatewayCalled = true;
        return {};
      },
    });

    await assert.rejects(
      deps.dispatchAction({ workspaceId: 'ws-a', groupId: 'group-1', account, action: action() }),
      (error) => error?.code === 'CTRADER_CBOT_NOT_CONNECTED',
    );
    assert.equal(gatewayCalled, false);
  });
}
