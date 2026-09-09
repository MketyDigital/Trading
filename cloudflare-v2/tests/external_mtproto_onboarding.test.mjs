import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';

const authorization = {
  workspace: { id: 'ws-1', trading_access_enabled: true },
  auth: { subject: 'owner-1' },
  membership: { workspaceId: 'ws-1', subject: 'owner-1', role: 'owner', enabled: true },
};

function sourceRow(overrides = {}) {
  return {
    id: 'src-external-1',
    workspaceId: 'ws-1',
    providerType: 'external_mtproto',
    sourceFamily: 'telegram',
    sourceType: 'telegram_mtproto',
    sourceInstanceId: 'external-userbot',
    displayName: 'External Telegram Userbot',
    enabled: false,
    isDefault: false,
    priority: 0,
    externalIdentity: null,
    publicSourceHandle: null,
    config: {},
    credentialConfigured: false,
    health: { status: 'DISABLED' },
    ...overrides,
  };
}

test('external MTProto creation returns a durable canonical one-time ingestion endpoint', async () => {
  let createdInput = null;
  const sourceStore = {
    async createSource(workspaceId, input) {
      assert.equal(workspaceId, 'ws-1');
      createdInput = input;
      return sourceRow();
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    new Request('https://copier.starpipsforex.com/api/v1/admin/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerType: 'external_mtproto',
        sourceFamily: 'telegram',
        sourceType: 'telegram_mtproto',
        sourceInstanceId: 'external-userbot',
        displayName: 'External Telegram Userbot',
        priority: 0,
      }),
    }),
    authorization,
    {
      sourceStore,
      env: { TRADING_CANONICAL_HOSTS: 'trade.mkety.com', TRADING_MASTER_KEY: 'configured' },
      generateIngressSecret: () => 'endpoint-secret-123',
      encryptIngressSecret: async (secret) => {
        assert.equal(secret, 'endpoint-secret-123');
        return 'v1.encrypted-ingress-secret';
      },
    },
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.source.providerType, 'external_mtproto');
  assert.equal(
    body.oneTimeEndpointUrl,
    'https://trade.mkety.com/api/v1/external/mtproto/src-external-1/endpoint-secret-123',
  );
  assert.equal(JSON.stringify(body.source).includes('endpoint-secret-123'), false);
  assert.equal(createdInput.ingressSecretCiphertext, 'v1.encrypted-ingress-secret');
});

test('later source list never exposes the external MTProto endpoint token or ciphertext', async () => {
  const sourceStore = {
    async listSources() {
      return [sourceRow({
        secret: 'endpoint-secret-123',
        secret_ciphertext: 'v1.encrypted-ingress-secret',
        provider_secret_ciphertext: 'must-not-return',
      })];
    },
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/sources'),
    authorization,
    { sourceStore, env: { TRADING_CANONICAL_HOSTS: 'trade.mkety.com' } },
  );
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(await response.json());
  assert.equal(serialized.includes('endpoint-secret-123'), false);
  assert.equal(serialized.includes('encrypted-ingress-secret'), false);
  assert.equal(serialized.includes('oneTimeEndpointUrl'), false);
});
