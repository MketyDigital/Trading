import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminAccountsRequest } from '../src/http/v1_admin_accounts.js';

const ownerAuthorization = {
  workspace: { id: 'ws-1' },
  auth: { subject: 'owner-1' },
  membership: { workspaceId: 'ws-1', subject: 'owner-1', role: 'owner', enabled: true },
};

function request(path, method, body) {
  return new Request(`https://trade.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function mt5Body(overrides = {}) {
  return {
    label: 'Primary MT5',
    platform: 'mt5',
    accountId: '100001',
    serverName: 'Broker-Live',
    active: true,
    executionEnabled: true,
    lotSizingType: 'fixed',
    lotValue: 0.01,
    safetyPolicy: { killSwitch: false, maxLotsPerTrade: 0.1 },
    credentials: {
      bridgeUrl: 'https://bridge.fixture.invalid',
      bridgeSecret: 'fixture-bridge-auth',
    },
    ...overrides,
  };
}

function ctraderBody(overrides = {}) {
  return {
    label: 'Primary cTrader',
    platform: 'ctrader',
    accountId: '200001',
    serverName: 'cTrader-Live',
    active: true,
    executionEnabled: true,
    lotSizingType: 'fixed',
    lotValue: 0.01,
    credentials: {
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-client-auth',
      accessToken: 'fixture-access-auth',
      refreshToken: 'fixture-refresh-auth',
    },
    ...overrides,
  };
}

function makeStore() {
  const calls = [];
  const rows = new Map();
  return {
    calls,
    rows,
    async createAccount(workspaceId, record) {
      calls.push(['createAccount', workspaceId, record]);
      const row = {
        id: 'acc-created',
        workspace_id: workspaceId,
        account_label: record.label,
        platform: record.platform,
        account_id: record.accountId,
        server_name: record.serverName,
        lot_sizing_type: record.lotSizingType,
        lot_value: record.lotValue,
        is_active: record.active,
        execution_enabled: record.executionEnabled,
        safety_policy: record.safetyPolicy,
        fast_entry_policy: record.fastEntryPolicy,
        entry_zone_policy: record.entryZonePolicy,
        credential_ciphertext: record.credentialCiphertext,
        created_at: '2026-09-05T12:00:00Z',
      };
      rows.set(row.id, row);
      return row;
    },
    async getAccount(workspaceId, accountId) {
      calls.push(['getAccount', workspaceId, accountId]);
      const row = rows.get(accountId);
      return row && row.workspace_id === workspaceId ? row : null;
    },
    async replaceAccountCredentials(workspaceId, accountId, credentialCiphertext) {
      calls.push(['replaceAccountCredentials', workspaceId, accountId, credentialCiphertext]);
      const row = rows.get(accountId);
      if (!row || row.workspace_id !== workspaceId) return null;
      const updated = { ...row, credential_ciphertext: credentialCiphertext };
      rows.set(accountId, updated);
      return updated;
    },
  };
}

function assertNoCredentialMaterial(body) {
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'fixture-bridge-auth',
    'fixture-client-auth',
    'fixture-access-auth',
    'fixture-refresh-auth',
    'fixture-encrypted-broker-envelope',
    'credential_ciphertext',
    'credentialCiphertext',
    'bridgeSecret',
    'clientSecret',
    'accessToken',
    'refreshToken',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(body.account || {}, 'credentials'), false);
}

test('owner creates production MT5 account with encrypted credentials and forced-safe account state', async () => {
  const store = makeStore();
  const encryptCalls = [];
  const response = await handleAuthorizedV1AdminAccountsRequest(
    request('/api/v1/admin/accounts', 'POST', mt5Body()),
    ownerAuthorization,
    {
      accountStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key', BROKER_EXECUTION_ENABLED: 'false' },
      encryptCredentials: async (kind, credentials, masterKey) => {
        encryptCalls.push([kind, credentials, masterKey]);
        return 'fixture-encrypted-broker-envelope';
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(encryptCalls.length, 1);
  assert.equal(encryptCalls[0][0], 'mt5');
  assert.equal(encryptCalls[0][2], 'fixture-master-key');

  const create = store.calls.find((call) => call[0] === 'createAccount');
  assert.ok(create);
  assert.equal(create[1], 'ws-1');
  assert.equal(create[2].active, false);
  assert.equal(create[2].executionEnabled, false);
  assert.equal(create[2].safetyPolicy.killSwitch, true);
  assert.equal(create[2].credentialCiphertext, 'fixture-encrypted-broker-envelope');
  assert.equal('credentials' in create[2], false);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.workspaceId, 'ws-1');
  assert.equal(body.masterBrokerExecutionEnabled, false);
  assert.equal(body.account.active, false);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.killSwitch, true);
  assert.equal(body.account.credentialConfigured, true);
  assertNoCredentialMaterial(body);
});

test('production cTrader onboarding uses the cTrader encrypted envelope and remains execution-disabled', async () => {
  const store = makeStore();
  const kinds = [];
  const response = await handleAuthorizedV1AdminAccountsRequest(
    request('/api/v1/admin/accounts', 'POST', ctraderBody()),
    ownerAuthorization,
    {
      accountStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key', BROKER_EXECUTION_ENABLED: 'true' },
      encryptCredentials: async (kind) => {
        kinds.push(kind);
        return 'fixture-encrypted-broker-envelope';
      },
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(kinds, ['ctrader']);
  const body = await response.json();
  assert.equal(body.masterBrokerExecutionEnabled, true);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.active, false);
  assert.equal(body.account.killSwitch, true);
  assertNoCredentialMaterial(body);
});

test('unsupported broker platform and invalid credential shapes fail before encryption or persistence', async () => {
  for (const payload of [
    mt5Body({ platform: 'unknown-platform' }),
    mt5Body({ credentials: { bridgeUrl: 'https://bridge.fixture.invalid', password: 'fixture-password' } }),
  ]) {
    const store = makeStore();
    let encryptCalls = 0;
    const response = await handleAuthorizedV1AdminAccountsRequest(
      request('/api/v1/admin/accounts', 'POST', payload),
      ownerAuthorization,
      {
        accountStore: store,
        env: { TRADING_MASTER_KEY: 'fixture-master-key' },
        encryptCredentials: async () => { encryptCalls += 1; return 'fixture-envelope'; },
      },
    );
    assert.equal(response.status, 400);
    assert.equal(encryptCalls, 0);
    assert.equal(store.calls.length, 0);
  }
});

test('caller without accounts.write cannot submit broker credentials', async () => {
  const store = makeStore();
  let encryptCalls = 0;
  const response = await handleAuthorizedV1AdminAccountsRequest(
    request('/api/v1/admin/accounts', 'POST', mt5Body()),
    { ...ownerAuthorization, membership: { ...ownerAuthorization.membership, role: 'viewer' } },
    {
      accountStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async () => { encryptCalls += 1; return 'fixture-envelope'; },
    },
  );
  assert.equal(response.status, 403);
  assert.equal(encryptCalls, 0);
  assert.equal(store.calls.length, 0);
});

test('credential rotation is exact-workspace, platform-typed, and preserves account safety/execution state', async () => {
  const store = makeStore();
  store.rows.set('acc-1', {
    id: 'acc-1', workspace_id: 'ws-1', account_label: 'Primary MT5', platform: 'mt5', account_id: '100001',
    server_name: 'Broker-Live', lot_sizing_type: 'fixed', lot_value: 0.01,
    is_active: true, execution_enabled: false, safety_policy: { killSwitch: true, maxLotsPerTrade: 0.1 },
    credential_ciphertext: 'fixture-old-envelope', created_at: '2026-09-05T12:00:00Z',
  });

  const response = await handleAuthorizedV1AdminAccountsRequest(
    request('/api/v1/admin/accounts/acc-1/credentials', 'PUT', {
      credentials: { bridgeUrl: 'https://bridge.fixture.invalid', bridgeSecret: 'fixture-bridge-auth' },
    }),
    ownerAuthorization,
    {
      accountStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key', BROKER_EXECUTION_ENABLED: 'false' },
      encryptCredentials: async (kind) => {
        assert.equal(kind, 'mt5');
        return 'fixture-encrypted-broker-envelope';
      },
    },
  );

  assert.equal(response.status, 200);
  const replace = store.calls.find((call) => call[0] === 'replaceAccountCredentials');
  assert.deepEqual(replace, ['replaceAccountCredentials', 'ws-1', 'acc-1', 'fixture-encrypted-broker-envelope']);
  const body = await response.json();
  assert.equal(body.account.active, true);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.killSwitch, true);
  assert.equal(body.account.credentialConfigured, true);
  assertNoCredentialMaterial(body);
});

test('credential rotation cannot reach an account outside the authenticated workspace', async () => {
  const store = makeStore();
  store.rows.set('acc-other', {
    id: 'acc-other', workspace_id: 'ws-2', account_label: 'Other', platform: 'ctrader', account_id: '200001',
    is_active: false, execution_enabled: false, safety_policy: { killSwitch: true }, credential_ciphertext: 'fixture-old-envelope',
  });
  let encryptCalls = 0;
  const response = await handleAuthorizedV1AdminAccountsRequest(
    request('/api/v1/admin/accounts/acc-other/credentials', 'PUT', { credentials: ctraderBody().credentials }),
    ownerAuthorization,
    {
      accountStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async () => { encryptCalls += 1; return 'fixture-envelope'; },
    },
  );
  assert.equal(response.status, 404);
  assert.equal(encryptCalls, 0);
  assert.equal(store.calls.some((call) => call[0] === 'replaceAccountCredentials'), false);
});
