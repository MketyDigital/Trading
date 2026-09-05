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

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'fixture-api-hash',
    'fixture-session',
    'fixture-encrypted-envelope',
    'providerSecretCiphertext',
    'credentials',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  }
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
