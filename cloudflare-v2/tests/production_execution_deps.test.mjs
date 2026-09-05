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
    credential_ciphertext: 'synthetic-account-envelope',
    server_name: 'Broker-Demo',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
    ...overrides,
  };
}

function mt5CredentialDecryptor(seen = null) {
  return async (kind, ciphertext, masterKey) => {
    if (seen) seen.decrypt = { kind, ciphertext, masterKey };
    return {
      bridgeUrl: 'https://server-bridge.example/base',
      bridgeSecret: 'server-bridge-secret',
    };
  };
}

function ctraderCredentialDecryptor(seen = null) {
  return async (kind, ciphertext, masterKey) => {
    if (seen) seen.decrypt = { kind, ciphertext, masterKey };
    return {
      clientId: 'server-client-id',
      clientSecret: 'server-client-secret',
      accessToken: 'server-account-access-token',
      refreshToken: 'server-refresh-token',
    };
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

test('MT5 dispatch uses exact account credential envelope plus database account authority and persistent workspace-scoped delivery store', async () => {
  const seen = {};
  const row = account();
  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master-key-placeholder' },
    supabase: createAccountQuerySupabase(row),
    workspaceId: 'ws-a',
    tradingEventId: 'event-db-id',
  }, {
    decryptCredentialsFn: mt5CredentialDecryptor(seen),
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
  assert.deepEqual(seen.decrypt, {
    kind: 'mt5',
    ciphertext: 'synthetic-account-envelope',
    masterKey: 'master-key-placeholder',
  });
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

test('cTrader dispatch decrypts exact account credential envelope server-side and caller cannot select credentials or live mode', async () => {
  const seen = {};
  const row = account({
    platform: 'ctrader',
    account_id: '123456',
    server_name: 'demo',
    credential_ciphertext: 'synthetic-ctrader-envelope',
    api_token_encrypted: 'legacy-token-must-not-be-used',
  });
  const deps = createProductionExecutionDependencies({
    env: {
      TRADING_MASTER_KEY: 'master-key-placeholder',
      CTRADER_LIVE_TRADING_ENABLED: 'false',
    },
    supabase: createAccountQuerySupabase(row),
    workspaceId: 'ws-a',
    tradingEventId: 'event-db-id',
  }, {
    decryptCredentialsFn: ctraderCredentialDecryptor(seen),
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
    kind: 'ctrader',
    ciphertext: 'synthetic-ctrader-envelope',
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
  assert.equal(JSON.stringify(seen.runtime).includes('legacy-token'), false);
});

test('live cTrader account remains fail-closed unless a separate server-side live opt-in is true', async () => {
  const row = account({
    platform: 'ctrader',
    account_id: '123456',
    server_name: 'live',
    credential_ciphertext: 'synthetic-live-envelope',
  });
  let runtimeCalls = 0;
  const deps = createProductionExecutionDependencies({
    env: {
      TRADING_MASTER_KEY: 'master',
      CTRADER_LIVE_TRADING_ENABLED: 'false',
    },
    supabase: createAccountQuerySupabase(row),
    workspaceId: 'ws-a',
  }, {
    decryptCredentialsFn: ctraderCredentialDecryptor(),
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    ctraderRuntimeFactory: async () => { runtimeCalls += 1; return { execute() {}, close() {} }; },
  });

  await assert.rejects(
    () => deps.dispatchAction({ workspaceId: 'ws-a', account: row, action: { type: 'OPEN_POSITION', idempotencyKey: 'k1' } }),
    /live cTrader execution is disabled/i,
  );
  assert.equal(runtimeCalls, 0);
});

test('unsupported platform and missing per-account credential authority fail before executor construction', async () => {
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

  const mt5 = account({ credential_ciphertext: null });
  const missing = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master' },
    supabase: createAccountQuerySupabase(mt5),
    workspaceId: 'ws-a',
  }, {
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    mt5Executor: async () => { throw new Error('must not execute'); },
  });
  await assert.rejects(
    () => missing.dispatchAction({ workspaceId: 'ws-a', account: mt5, action: { type: 'OPEN_POSITION', idempotencyKey: 'k1' } }),
    /credential_ciphertext/,
  );
});

test('production dependencies expose only whitelisted nonauthoritative snapshot configuration', async () => {
  const row = account({
    sizing_mode: 'FIXED_LOTS',
    fast_entry_policy: 'WAIT_FOR_COMPLETE_SIGNAL',
    entry_zone_policy: 'NEAREST_BOUNDARY',
    api_token_encrypted: 'must-never-enter-snapshot',
    credential_ciphertext: 'credential-envelope-must-never-enter-snapshot',
    safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 1 },
    current_daily_pnl_percent: -4,
    current_open_risk_percent: 3,
  });
  const deps = createProductionExecutionDependencies({
    env: {},
    supabase: createAccountQuerySupabase(row),
    workspaceId: 'ws-a',
  }, {
    deliveryStoreFactory: () => ({}),
  });

  assert.equal(typeof deps.snapshotLoader, 'function');

  const snapshot = await deps.snapshotLoader({
    workspaceId: 'ws-a',
    sourceId: 'src-a',
    account: row,
  });

  assert.equal(snapshot.workspaceId, 'ws-a');
  assert.equal(snapshot.sourceId, 'src-a');
  assert.equal(snapshot.accountId, 'acct-row-a');
  assert.equal(snapshot.platform, 'mt5');
  assert.equal(snapshot.serverName, 'Broker-Demo');
  assert.equal(snapshot.sizingMode, 'FIXED_LOTS');
  assert.equal(snapshot.fastEntryPolicy, 'WAIT_FOR_COMPLETE_SIGNAL');
  assert.equal(snapshot.entryZonePolicy, 'NEAREST_BOUNDARY');
  assert.equal(typeof snapshot.version, 'string');

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'api_token_encrypted', 'must-never-enter-snapshot', 'credential_ciphertext', 'credential-envelope-must-never-enter-snapshot',
    'safety_policy', 'killSwitch', 'execution_enabled', 'is_active',
    'current_daily_pnl_percent', 'current_open_risk_percent',
    'TRADING_ACCESS_ENABLED', 'BROKER_EXECUTION_ENABLED',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `snapshot leaked mutable/secret authority: ${forbidden}`);
  }

  const replay = await deps.snapshotLoader({
    workspaceId: 'ws-a',
    sourceId: 'src-a',
    account: row,
  });
  assert.deepEqual(replay, snapshot);
});