import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function unexpectedSupabase() {
  return { from() { throw new Error('unexpected database query'); } };
}

test('live-shaped cTrader dispatch reaches only the injected fake runtime when server live gate is enabled', async () => {
  const seen = {};
  const account = {
    id: 'acct-ct-live',
    workspace_id: 'ws-live',
    platform: 'ctrader',
    account_id: '654321',
    server_name: 'live',
    credential_ciphertext: 'synthetic-live-credential-envelope',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };

  const deps = createProductionExecutionDependencies({
    env: {
      TRADING_MASTER_KEY: 'synthetic-master-key',
      CTRADER_LIVE_TRADING_ENABLED: 'true',
    },
    supabase: unexpectedSupabase(),
    workspaceId: 'ws-live',
    tradingEventId: 'event-live-shaped',
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
    deliveryStoreFactory: (_supabase, options) => {
      seen.delivery = options;
      return { reserve() {}, complete() {}, fail() {} };
    },
    ctraderRuntimeFactory: async (options) => {
      seen.runtime = options;
      return {
        async execute(action) {
          seen.action = action;
          return {
            brokerPositionId: 'fake-live-position-1',
            brokerOrderId: 'fake-live-order-1',
            fillPrice: 2500.25,
          };
        },
        async close() { seen.closed = true; },
      };
    },
  });

  const result = await deps.dispatchAction({
    workspaceId: 'ws-live',
    groupId: 'group-live-shaped',
    account,
    action: {
      type: 'OPEN_POSITION',
      symbol: 'XAUUSD',
      lots: 0.01,
      idempotencyKey: 'group-live-shaped:leg:1',
    },
  });
  await deps.finalizeExecutionBatch();

  assert.deepEqual(seen.decrypt, {
    kind: 'ctrader',
    ciphertext: 'synthetic-live-credential-envelope',
    masterKey: 'synthetic-master-key',
  });
  assert.equal(seen.runtime.environment, 'live');
  assert.equal(seen.runtime.allowLiveTrading, true);
  assert.equal(seen.runtime.clientId, 'synthetic-client-id');
  assert.equal(seen.runtime.clientSecret, 'synthetic-client-secret');
  assert.equal(seen.runtime.accessToken, 'synthetic-access-token');
  assert.equal(seen.runtime.accountId, 654321);
  assert.deepEqual(seen.delivery, {
    workspaceId: 'ws-live',
    destinationType: 'ctrader',
    destinationRef: 'trade-account:acct-ct-live',
    tradingEventId: 'event-live-shaped',
  });
  assert.equal(seen.action.idempotencyKey, 'group-live-shaped:leg:1');
  assert.equal(result.brokerPositionId, 'fake-live-position-1');
  assert.equal(seen.closed, true);
});
