import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';

const authorization = {
  workspace: { id: 'ws-1' },
  auth: { subject: 'owner-1' },
  membership: { workspaceId: 'ws-1', subject: 'owner-1', role: 'owner', enabled: true },
};

function request(body) {
  return new Request('https://trade.test/api/v1/admin/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function telegramBody(overrides = {}) {
  return {
    providerType: 'cloudflare_container_mtproto',
    sourceFamily: 'telegram',
    sourceType: 'telegram_mtproto',
    sourceInstanceId: 'telegram-primary',
    displayName: 'Primary Telegram',
    externalIdentity: 'telegram-user-fixture',
    priority: 10,
    enabled: false,
    config: { chat_ids: ['fixture-chat-id'] },
    credentials: {
      apiId: 'fixture-api-id',
      apiHash: 'fixture-api-hash',
      session: 'fixture-session',
    },
    ...overrides,
  };
}

function mt5Body(overrides = {}) {
  return {
    providerType: 'mt5_source_bridge',
    sourceFamily: 'mt5',
    sourceType: 'mt5_account_stream',
    sourceInstanceId: 'mt5-primary',
    displayName: 'Primary MT5 Source',
    externalIdentity: '90001',
    priority: 20,
    config: { expectedServer: 'Broker-Demo' },
    credentials: {
      bridgeUrl: 'https://mt5-source.example',
      bridgeSecret: 'fixture-mt5-source-secret',
    },
    ...overrides,
  };
}

function ctraderBody(overrides = {}) {
  return {
    providerType: 'ctrader_source',
    sourceFamily: 'ctrader',
    sourceType: 'ctrader_account_stream',
    sourceInstanceId: 'ctrader-primary',
    displayName: 'Primary cTrader Source',
    externalIdentity: '123456',
    priority: 30,
    config: { environment: 'demo' },
    credentials: {
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-client-secret',
      accessToken: 'fixture-access-token',
      refreshToken: 'fixture-refresh-token',
    },
    ...overrides,
  };
}

function makeStore() {
  const calls = [];
  return {
    calls,
    async createSource(workspaceId, record) {
      calls.push(['createSource', workspaceId, record]);
      return {
        id: 'src-created',
        workspaceId,
        providerType: record.providerType,
        sourceFamily: record.sourceFamily,
        sourceType: record.sourceType,
        sourceInstanceId: record.sourceInstanceId,
        displayName: record.displayName,
        enabled: record.enabled,
        isDefault: false,
        priority: record.priority,
        externalIdentity: record.externalIdentity,
        config: record.config,
        providerSecretCiphertext: record.providerSecretCiphertext,
        health: { status: 'DISABLED', restartCount: 0 },
      };
    },
  };
}

test('workspace owner creates MTProto source with encrypted-at-rest provider credentials and no credential reflection', async () => {
  const store = makeStore();
  const encryptCalls = [];
  const encryptCredentials = async (kind, credentials, masterKey) => {
    encryptCalls.push([kind, credentials, masterKey]);
    return 'fixture-encrypted-envelope';
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request(telegramBody()),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials,
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(encryptCalls, [[
    'mtproto',
    { apiId: 'fixture-api-id', apiHash: 'fixture-api-hash', session: 'fixture-session' },
    'fixture-master-key',
  ]]);

  assert.equal(store.calls.length, 1);
  const [operation, workspaceId, persisted] = store.calls[0];
  assert.equal(operation, 'createSource');
  assert.equal(workspaceId, 'ws-1');
  assert.equal(persisted.providerSecretCiphertext, 'fixture-encrypted-envelope');
  assert.equal('credentials' in persisted, false);
  assert.deepEqual(persisted.config, { chat_ids: ['fixture-chat-id'] });

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.workspaceId, 'ws-1');
  assert.equal(body.source.id, 'src-created');
  assert.equal(body.source.credentialConfigured, true);
  assert.equal('credentials' in body.source, false);
  assert.equal('providerSecretCiphertext' in body.source, false);

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'fixture-api-id',
    'fixture-api-hash',
    'fixture-session',
    'fixture-encrypted-envelope',
    '"providerSecretCiphertext":',
    '"credentials":',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  }
});

test('workspace owner creates MT5 source with an MT5-typed encrypted credential envelope', async () => {
  const store = makeStore();
  const encryptCalls = [];
  const response = await handleAuthorizedV1AdminSourcesRequest(
    request(mt5Body()),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async (kind, credentials, masterKey) => {
        encryptCalls.push([kind, credentials, masterKey]);
        return 'fixture-mt5-envelope';
      },
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(encryptCalls, [[
    'mt5',
    { bridgeUrl: 'https://mt5-source.example', bridgeSecret: 'fixture-mt5-source-secret' },
    'fixture-master-key',
  ]]);
  assert.equal(store.calls[0][2].providerSecretCiphertext, 'fixture-mt5-envelope');
  assert.equal(store.calls[0][2].enabled, false);
  assert.equal(JSON.stringify(await response.json()).includes('fixture-mt5-source-secret'), false);
});

test('workspace owner creates cTrader source with a cTrader-typed encrypted credential envelope', async () => {
  const store = makeStore();
  const encryptCalls = [];
  const response = await handleAuthorizedV1AdminSourcesRequest(
    request(ctraderBody()),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async (kind, credentials, masterKey) => {
        encryptCalls.push([kind, credentials, masterKey]);
        return 'fixture-ctrader-envelope';
      },
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(encryptCalls, [[
    'ctrader',
    {
      clientId: 'fixture-client-id',
      clientSecret: 'fixture-client-secret',
      accessToken: 'fixture-access-token',
      refreshToken: 'fixture-refresh-token',
    },
    'fixture-master-key',
  ]]);
  assert.equal(store.calls[0][2].providerSecretCiphertext, 'fixture-ctrader-envelope');
  assert.equal(store.calls[0][2].enabled, false);
  const serialized = JSON.stringify(await response.json());
  assert.equal(serialized.includes('fixture-client-secret'), false);
  assert.equal(serialized.includes('fixture-access-token'), false);
});

test('source onboarding rejects provider/family mismatch before encryption or persistence', async () => {
  const store = makeStore();
  let encryptCalls = 0;

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request(telegramBody({ sourceFamily: 'mt5' })),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async () => { encryptCalls += 1; return 'fixture-envelope'; },
    },
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'SOURCE_PROVIDER_FAMILY_MISMATCH');
  assert.equal(encryptCalls, 0);
  assert.deepEqual(store.calls, []);
});

test('caller without sources.write cannot submit MTProto connection data', async () => {
  const store = makeStore();
  let encryptCalls = 0;
  const viewerAuthorization = {
    ...authorization,
    membership: { ...authorization.membership, role: 'viewer' },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request(telegramBody()),
    viewerAuthorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async () => { encryptCalls += 1; return 'fixture-envelope'; },
    },
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'TRADING_PERMISSION_DENIED');
  assert.equal(encryptCalls, 0);
  assert.deepEqual(store.calls, []);
});