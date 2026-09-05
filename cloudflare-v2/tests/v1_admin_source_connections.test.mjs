import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';
import { decryptConnectionCredentials } from '../src/security/connection_credentials.js';

const masterKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';

function authorization(role = 'owner') {
  return {
    workspace: { id: workspaceId },
    membership: { role },
  };
}

function mtprotoBody(overrides = {}) {
  return {
    workspaceId: 'attacker-workspace-must-be-ignored',
    providerType: 'external_mtproto',
    sourceFamily: 'telegram',
    sourceType: 'telegram',
    sourceInstanceId: 'starpips-primary',
    displayName: 'Starpips Telegram',
    externalIdentity: '@starpips',
    config: {
      chat_acceptance_mode: 'allowlist',
      allowed_chat_ids: ['-1001234567890'],
    },
    credentials: {
      apiId: '12345',
      apiHash: 'api-hash-secret',
      session: 'telegram-session-secret',
    },
    ...overrides,
  };
}

function request(path, method, body) {
  return new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('owner can create an inactive MTProto source with encrypted credentials scoped to authorized workspace', async () => {
  let createCall = null;
  const sourceStore = {
    async createSource(authoritativeWorkspaceId, input, credentialCiphertext) {
      createCall = { authoritativeWorkspaceId, input, credentialCiphertext };
      return {
        id: sourceId,
        workspaceId: authoritativeWorkspaceId,
        providerType: input.providerType,
        sourceFamily: input.sourceFamily,
        sourceType: input.sourceType,
        sourceInstanceId: input.sourceInstanceId,
        displayName: input.displayName,
        externalIdentity: input.externalIdentity,
        config: input.config,
        enabled: false,
        isDefault: false,
        priority: 0,
        providerSecretCiphertext: credentialCiphertext,
        health: { status: 'DISABLED', restartCount: 0 },
      };
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request('/api/v1/admin/sources', 'POST', mtprotoBody()),
    authorization(),
    { sourceStore, env: { TRADING_MASTER_KEY: masterKey } },
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(createCall.authoritativeWorkspaceId, workspaceId);
  assert.equal(createCall.input.workspaceId, undefined);
  assert.equal(createCall.input.enabled, false);
  assert.equal(JSON.stringify(createCall.input.config).includes('api-hash-secret'), false);
  assert.equal(JSON.stringify(createCall.input.config).includes('telegram-session-secret'), false);
  assert.equal(createCall.credentialCiphertext.includes('api-hash-secret'), false);
  assert.deepEqual(
    await decryptConnectionCredentials('mtproto', createCall.credentialCiphertext, masterKey),
    { apiId: '12345', apiHash: 'api-hash-secret', session: 'telegram-session-secret' },
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.workspaceId, workspaceId);
  assert.equal(payload.source.credentialsConfigured, true);
  assert.equal(JSON.stringify(payload).includes('api-hash-secret'), false);
  assert.equal(JSON.stringify(payload).includes('telegram-session-secret'), false);
  assert.equal(JSON.stringify(payload).includes(createCall.credentialCiphertext), false);
});

test('source creation rejects provider/source-family mismatch before persistence', async () => {
  let called = false;
  const sourceStore = {
    async createSource() {
      called = true;
      throw new Error('must not be called');
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request('/api/v1/admin/sources', 'POST', mtprotoBody({ sourceFamily: 'mt5' })),
    authorization(),
    { sourceStore, env: { TRADING_MASTER_KEY: masterKey } },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.reason, 'SOURCE_PROVIDER_FAMILY_MISMATCH');
  assert.equal(called, false);
});

test('source creation rejects unsupported secret keys and never calls persistence', async () => {
  let called = false;
  const sourceStore = {
    async createSource() {
      called = true;
      throw new Error('must not be called');
    },
  };

  const body = mtprotoBody();
  body.credentials.password = 'should-never-be-accepted';

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request('/api/v1/admin/sources', 'POST', body),
    authorization(),
    { sourceStore, env: { TRADING_MASTER_KEY: masterKey } },
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.reason, 'SOURCE_CREDENTIALS_INVALID');
  assert.equal(called, false);
});

test('viewer cannot create a source', async () => {
  let called = false;
  const sourceStore = { async createSource() { called = true; } };
  const response = await handleAuthorizedV1AdminSourcesRequest(
    request('/api/v1/admin/sources', 'POST', mtprotoBody()),
    authorization('viewer'),
    { sourceStore, env: { TRADING_MASTER_KEY: masterKey } },
  );
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.reason, 'TRADING_PERMISSION_DENIED');
  assert.equal(called, false);
});

test('owner can replace source credentials without receiving plaintext or ciphertext back', async () => {
  let replaceCall = null;
  const sourceStore = {
    async replaceSourceCredentials(authoritativeWorkspaceId, id, credentialCiphertext) {
      replaceCall = { authoritativeWorkspaceId, id, credentialCiphertext };
      return {
        id,
        workspaceId: authoritativeWorkspaceId,
        providerType: 'external_mtproto',
        sourceFamily: 'telegram',
        sourceType: 'telegram',
        sourceInstanceId: 'starpips-primary',
        displayName: 'Starpips Telegram',
        externalIdentity: '@starpips',
        config: { chat_acceptance_mode: 'all_visible', allowed_chat_ids: [] },
        enabled: false,
        isDefault: false,
        priority: 0,
        providerSecretCiphertext: credentialCiphertext,
        health: { status: 'DISABLED', restartCount: 0 },
      };
    },
  };

  const credentials = { apiId: '99999', apiHash: 'new-hash', session: 'new-session' };
  const response = await handleAuthorizedV1AdminSourcesRequest(
    request(`/api/v1/admin/sources/${sourceId}/credentials`, 'PUT', { credentials }),
    authorization(),
    { sourceStore, env: { TRADING_MASTER_KEY: masterKey } },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(replaceCall.authoritativeWorkspaceId, workspaceId);
  assert.equal(replaceCall.id, sourceId);
  assert.deepEqual(
    await decryptConnectionCredentials('mtproto', replaceCall.credentialCiphertext, masterKey),
    credentials,
  );
  assert.equal(payload.source.credentialsConfigured, true);
  assert.equal(JSON.stringify(payload).includes('new-session'), false);
  assert.equal(JSON.stringify(payload).includes(replaceCall.credentialCiphertext), false);
});

test('source creation maps persistence failure to stable safe error', async () => {
  const sourceStore = {
    async createSource() {
      throw new Error('database detail that must not leak');
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    request('/api/v1/admin/sources', 'POST', mtprotoBody()),
    authorization(),
    { sourceStore, env: { TRADING_MASTER_KEY: masterKey } },
  );
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.reason, 'SOURCE_CREATE_FAILED');
  assert.equal(JSON.stringify(payload).includes('database detail'), false);
});
