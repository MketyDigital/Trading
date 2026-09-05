import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function accountRow() {
  return {
    id: 'acct-row-a',
    workspace_id: 'ws-a',
    platform: 'mt5',
    account_id: '90001',
    credential_ciphertext: 'synthetic-account-envelope',
    server_name: 'Broker-Demo',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

function accountSupabase(row) {
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: row, error: null }; },
  };
  return { from() { return query; } };
}

test('normal production delivery persists trusted account/group/destination retry context and durable event linkage rather than caller hints', async () => {
  const row = accountRow();
  let reservedPayload;
  let deliveryStoreContext;
  const baseStore = {
    async reserve(_key, payload) {
      reservedPayload = payload;
      return { ok: true, duplicate: false };
    },
    async complete() {},
    async fail() {},
    async markRetryable() {},
    async markUncertain() {},
  };

  const deps = createProductionExecutionDependencies({
    env: {
      TRADING_MASTER_KEY: 'master-key-placeholder',
    },
    supabase: accountSupabase(row),
    workspaceId: 'ws-a',
    tradingEventId: 'evt-db-1',
  }, {
    decryptCredentialsFn: async (kind, ciphertext, masterKey) => {
      assert.equal(kind, 'mt5');
      assert.equal(ciphertext, 'synthetic-account-envelope');
      assert.equal(masterKey, 'master-key-placeholder');
      return {
        bridgeUrl: 'https://bridge.example',
        bridgeSecret: 'server-secret',
      };
    },
    deliveryStoreFactory: (_supabase, context) => {
      deliveryStoreContext = context;
      return baseStore;
    },
    mt5ContextLoader: async () => ({ catalog: [] }),
    mt5Executor: async (action, options) => {
      await options.deliveryStore.reserve(action.idempotencyKey, { action });
      return { brokerPositionId: 'p-1' };
    },
  });

  await deps.dispatchAction({
    workspaceId: 'ws-a',
    groupId: 'trusted-group-1',
    account: row,
    action: {
      type: 'OPEN_POSITION',
      idempotencyKey: 'k-1',
      groupId: 'attacker-group',
      accountId: 'attacker-account',
      destinationType: 'ctrader',
      tradingEventId: 'attacker-event',
    },
  });

  assert.deepEqual(deliveryStoreContext, {
    workspaceId: 'ws-a',
    destinationType: 'mt5',
    destinationRef: 'trade-account:acct-row-a',
    tradingEventId: 'evt-db-1',
  });
  assert.equal(reservedPayload.groupId, 'trusted-group-1');
  assert.equal(reservedPayload.accountId, 'acct-row-a');
  assert.equal(reservedPayload.destinationType, 'mt5');
  assert.equal(reservedPayload.action.idempotencyKey, 'k-1');
  assert.notEqual(deliveryStoreContext.tradingEventId, 'attacker-event');
});