import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function createAccountQuerySupabase(row) {
  const calls = [];
  const query = {
    select(value) { calls.push(['select', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    async maybeSingle() { calls.push(['maybeSingle']); return { data: row, error: null }; },
  };
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      assert.equal(table, 'trade_accounts');
      return query;
    },
  };
}

function account(overrides = {}) {
  return {
    id: 'acct-row-a',
    workspace_id: 'ws-a',
    platform: 'mt5',
    account_id: '90001',
    api_token_encrypted: 'encrypted-account-token',
    server_name: 'Broker-Demo',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
    ...overrides,
  };
}

test('account loader is permanently bound to one workspace and one exact trade account id', async () => {
  const supabase = createAccountQuerySupabase(account());
  const deps = createProductionExecutionDependencies({
    env: {},
    supabase,
    workspaceId: 'ws-a',
  }, {
    deliveryStoreFactory: () => ({}),
    mt5ContextLoader: async () => ({ catalog: [] }),
    mt5Executor: async () => ({ ok: true }),
  });

  const loaded = await deps.accountLoader('ws-a', 'acct-row-a');
  assert.equal(loaded.id, 'acct-row-a');
  assert.deepEqual(supabase.calls, [
    ['from', 'trade_accounts'],
    ['select', '*'],
    ['eq', 'workspace_id', 'ws-a'],
    ['eq', 'id', 'acct-row-a'],
    ['maybeSingle'],
  ]);

  await assert.rejects(
    () => deps.accountLoader('ws-b', 'acct-row-a'),
    /workspace mismatch/i,
  );
});

test('MT5 dispatch uses only server env plus exact database account authority and persistent workspace-scoped delivery store', async () => {
  const seen = {};
  const row = account();
  const deps = createProductionExecutionDependencies({
    env: {
      MT5_BRIDGE_URL: 'https://server-bridge.example/base',
      MT5_BRIDGE_SECRET: 'server-bridge-secret',
    },
    supabase: createAccountQuerySupabase(row),
    workspaceId: 'ws-a',
    tradingEventId: 'event-db-id',
  }, {
    deliveryStoreFactory: (_supabase, options) => {
      seen.store = options;
      return { reserve() {}, complete() {}, fail() {} };
    },
    mt5ContextLoader: async (options) => {
      seen.context = options;
      return { catalog: [{ canonical: 'XAUUSD', platform: 'mt5', platformSymbol: 'XAUUSD' }] };
    },
    mt5Executor: async (action, options) => {
      seen.action = action;
      seen.executor = options;
      return { brokerPositionId: 'position-1', fillPrice: 2500.5 };
    },
  });

  const result = await deps.dispatchAction({
    workspaceId: 'ws-a',
    eventId: 'evt-1',
    account: row,
    action: {
      type: 'OPEN_POSITION',
      symbol: 'XAUUSD',
      idempotencyKey: 'evt-1:acct-row-a:1',
      bridgeUrl: 'https://attacker.invalid',
      bridgeSecret: 'attacker-secret',
      accountId: 'attacker-account',
      platform: 'ctrader',
    },
  });

  assert.equal(result.brokerPositionId, 'position-1');
  assert.deepEqual(seen.store, {
    workspaceId: 'ws-a',
    destinationType: 'mt5',
    destinationRef: 'trade-account:acct-row-a',
    tradingEventId: 'event-db-id',
  });
  assert.equal(seen.context.bridgeUrl, 'https://server-bridge.example/base');
  assert.equal(seen.context.accountId, '90001');
  assert.equal(seen.context.serverName, 'Broker-Demo');
  assert.equal(seen.executor.workspaceId, 'ws-a');
  assert.equal(seen.executor.accountId, '90001');
  assert.equal(seen.executor.bridgeSecret, 'server-bridge-secret');
  assert.match(seen.executor.bridgeUrl, /^https:\/\/server-bridge\.example\/base\/v1\/command$/);
  assert.equal(JSON.stringify(seen.executor).includes('attacker'), false);
});

test('cTrader dispatch decrypts exact account token server-side and caller cannot select credentials or live mode', async () => {
  const seen = {};
  const row = account({
    platform: 'ctrader',
    account_id: '123456',
    server_name: 'demo',
    api_token_encrypted: 'ciphertext-row-a',
  });
  const deps = createProductionExecutionDependencies({
    env: {
      TRADING_MASTER_KEY: 'master-key-placeholder',
      CTRADER_CLIENT_ID: 'server-client-id',
      CTRADER_CLIENT_SECRET: 'server-client-secret',
      CTRADER_LIVE_TRADING_ENABLED: 'false',
    },
    supabase: createAccountQuerySupabase(row),
    workspaceId: 'ws-a',
    tradingEventId: 'event-db-id',
  }, {
    decryptFn: async (ciphertext, masterKey) => {
      seen.decrypt = { ciphertext, masterKey };
      return 'server-account-access-token';
    },
    deliveryStoreFactory: (_supabase, options) => {
      seen.store = options;
      return { reserve() {}, complete() {}, fail() {} };
    },
    ctraderRuntimeFactory: async (options) => {
      seen.runtime = options;
      return {
        async execute(action) { seen.action = action; return { brokerPositionId: 'ct-position-1' }; },
        close() { seen.closed = true; },
      };
    },
  });

  const result = await deps.dispatchAction({
    workspaceId: 'ws-a',
    account: row,
    action: {
      type: 'OPEN_POSITION',
      symbol: 'XAUUSD',
      idempotencyKey: 'evt-1:acct-row-a:1',
      accessToken: 'attacker-token',
      clientId: 'attacker-client',
      environment: 'live',
      allowLiveTrading: true,
    },
  });

  assert.equal(result.brokerPositionId, 'ct-position-1');
  assert.deepEqual(seen.decrypt, {
    ciphertext: 'ciphertext-row-a',
    masterKey: 'master-key-placeholder',
  });
  assert.equal(seen.runtime.environment, 'demo');
  assert.equal(seen.runtime.allowLiveTrading, false);
  assert.equal(seen.runtime.clientId, 'server-client-id');
  assert.equal(seen.runtime.clientSecret, 'server-client-secret');
  assert.equal(seen.runtime.accessToken, 'server-account-access-token');
  assert.equal(seen.runtime.accountId, 123456);
  assert.equal(seen.closed, true);
  assert.equal(JSON.stringify(seen.runtime).includes('attacker'), false);
});

test('live cTrader account remains fail-closed unless a separate server-side live opt-in is true', async () => {
  const row = account({
    platform: 'ctrader',
    account_id: '123456',
    server_name: 'live',
  });
  let runtimeCalls = 0;
  const deps = createProductionExecutionDependencies({
    env: {
      TRADING_MASTER_KEY: 'master',
      CTRADER_CLIENT_ID: 'client',
      CTRADER_CLIENT_SECRET: 'secret',
      CTRADER_LIVE_TRADING_ENABLED: 'false',
    },
    supabase: createAccountQuerySupabase(row),
    workspaceId: 'ws-a',
  }, {
    decryptFn: async () => 'token',
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    ctraderRuntimeFactory: async () => { runtimeCalls += 1; return { execute() {}, close() {} }; },
  });

  await assert.rejects(
    () => deps.dispatchAction({ workspaceId: 'ws-a', account: row, action: { type: 'OPEN_POSITION', idempotencyKey: 'k1' } }),
    /live cTrader execution is disabled/i,
  );
  assert.equal(runtimeCalls, 0);
});

test('unsupported platform and missing server-side platform configuration fail before executor construction', async () => {
  const unsupported = account({ platform: 'deriv' });
  const deps = createProductionExecutionDependencies({
    env: {},
    supabase: createAccountQuerySupabase(unsupported),
    workspaceId: 'ws-a',
  });
  await assert.rejects(
    () => deps.dispatchAction({ workspaceId: 'ws-a', account: unsupported, action: { type: 'OPEN_POSITION', idempotencyKey: 'k1' } }),
    /unsupported production broker platform/i,
  );

  const mt5 = account();
  const missing = createProductionExecutionDependencies({
    env: {},
    supabase: createAccountQuerySupabase(mt5),
    workspaceId: 'ws-a',
  }, {
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    mt5Executor: async () => { throw new Error('must not execute'); },
  });
  await assert.rejects(
    () => missing.dispatchAction({ workspaceId: 'ws-a', account: mt5, action: { type: 'OPEN_POSITION', idempotencyKey: 'k1' } }),
    /MT5_BRIDGE_URL|MT5_BRIDGE_SECRET/,
  );
});
