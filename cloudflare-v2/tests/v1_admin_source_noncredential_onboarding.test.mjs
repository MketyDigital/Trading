import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';

const authorization = {
  workspace: { id: 'ws-1' },
  auth: { subject: 'owner-1' },
  membership: { workspaceId: 'ws-1', subject: 'owner-1', role: 'owner', enabled: true },
};

function createRequest(body) {
  return new Request('https://trade.test/api/v1/admin/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function rotateRequest(sourceId) {
  return new Request(`https://trade.test/api/v1/admin/sources/${sourceId}/credentials`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

function makeStore() {
  const calls = [];
  const sources = new Map();
  return {
    calls,
    sources,
    async createSource(workspaceId, input) {
      calls.push(['createSource', workspaceId, input]);
      const source = {
        id: input.providerType === 'tradingview_webhook' ? 'src-tv' : 'src-custom',
        workspaceId,
        providerType: input.providerType,
        sourceFamily: input.sourceFamily,
        sourceType: input.sourceType,
        sourceInstanceId: input.sourceInstanceId,
        displayName: input.displayName,
        enabled: false,
        isDefault: false,
        priority: input.priority,
        externalIdentity: input.externalIdentity,
        publicSourceHandle: input.publicSourceHandle ?? null,
        config: input.config || {},
        health: { status: 'DISABLED', restartCount: 0 },
      };
      sources.set(source.id, source);
      return source;
    },
    async getSource(workspaceId, sourceId) {
      calls.push(['getSource', workspaceId, sourceId]);
      return workspaceId === 'ws-1' ? sources.get(sourceId) ?? null : null;
    },
    async replaceIngressSecret(workspaceId, sourceId, secretCiphertext) {
      calls.push(['replaceIngressSecret', workspaceId, sourceId, secretCiphertext]);
      const source = sources.get(sourceId);
      return source && workspaceId === 'ws-1' ? source : null;
    },
  };
}

test('workspace owner creates TradingView source without provider credentials and receives only its safe webhook path', async () => {
  const store = makeStore();
  let providerEncryptCalls = 0;

  const response = await handleAuthorizedV1AdminSourcesRequest(
    createRequest({
      providerType: 'tradingview_webhook',
      sourceFamily: 'tradingview',
      sourceType: 'tradingview_webhook',
      sourceInstanceId: 'tv-primary',
      displayName: 'Primary TradingView',
      priority: 40,
      config: { label: 'alerts' },
    }),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async () => { providerEncryptCalls += 1; return 'must-not-run'; },
      generatePublicSourceHandle: () => 'tv_fixture_handle',
      generateIngressSecret: () => 'fixture-internal-ingress-secret',
      encryptIngressSecret: async () => 'fixture-internal-ingress-ciphertext',
    },
  );

  assert.equal(response.status, 201);
  assert.equal(providerEncryptCalls, 0);
  assert.equal(store.calls.length, 1);
  const persisted = store.calls[0][2];
  assert.equal(persisted.providerType, 'tradingview_webhook');
  assert.equal(persisted.publicSourceHandle, 'tv_fixture_handle');
  assert.equal(persisted.ingressSecretCiphertext, 'fixture-internal-ingress-ciphertext');
  assert.equal(persisted.providerSecretCiphertext, null);
  assert.equal(persisted.enabled, false);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.source.publicSourceHandle, 'tv_fixture_handle');
  assert.equal(body.source.webhookPath, '/api/v1/webhooks/tradingview/tv_fixture_handle');
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('fixture-internal-ingress-secret'), false);
  assert.equal(serialized.includes('fixture-internal-ingress-ciphertext'), false);
  assert.equal(serialized.includes('must-not-run'), false);
});

test('workspace owner creates Custom Signed API source and receives signing secret exactly once', async () => {
  const store = makeStore();
  let providerEncryptCalls = 0;

  const response = await handleAuthorizedV1AdminSourcesRequest(
    createRequest({
      providerType: 'custom_signed_api',
      sourceFamily: 'custom_api',
      sourceType: 'custom_signed_api',
      sourceInstanceId: 'custom-primary',
      displayName: 'Primary Custom API',
      priority: 50,
      config: { producer: 'customer-system' },
    }),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async () => { providerEncryptCalls += 1; return 'must-not-run'; },
      generateIngressSecret: () => 'fixture-custom-signing-secret',
      encryptIngressSecret: async (value, key) => {
        assert.equal(value, 'fixture-custom-signing-secret');
        assert.equal(key, 'fixture-master-key');
        return 'fixture-custom-signing-ciphertext';
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(providerEncryptCalls, 0);
  const persisted = store.calls[0][2];
  assert.equal(persisted.ingressSecretCiphertext, 'fixture-custom-signing-ciphertext');
  assert.equal(persisted.providerSecretCiphertext, null);
  assert.equal(persisted.enabled, false);

  const body = await response.json();
  assert.equal(body.oneTimeSigningSecret, 'fixture-custom-signing-secret');
  assert.equal(body.source.id, 'src-custom');
  assert.equal('oneTimeSigningSecret' in body.source, false);
  assert.equal(JSON.stringify(body.source).includes('fixture-custom-signing-secret'), false);
});

test('workspace owner rotates Custom Signed API signing secret using persisted provider authority', async () => {
  const store = makeStore();
  store.sources.set('src-custom', {
    id: 'src-custom',
    workspaceId: 'ws-1',
    providerType: 'custom_signed_api',
    sourceFamily: 'custom_api',
    sourceType: 'custom_signed_api',
    sourceInstanceId: 'custom-primary',
    enabled: true,
    isDefault: true,
    priority: 50,
    config: {},
    health: { status: 'HEALTHY', restartCount: 0 },
  });

  const response = await handleAuthorizedV1AdminSourcesRequest(
    rotateRequest('src-custom'),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      generateIngressSecret: () => 'fixture-rotated-custom-secret',
      encryptIngressSecret: async (value, key) => {
        assert.equal(value, 'fixture-rotated-custom-secret');
        assert.equal(key, 'fixture-master-key');
        return 'fixture-rotated-custom-ciphertext';
      },
      encryptCredentials: async () => { throw new Error('provider credential encryption must not run'); },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(store.calls, [
    ['getSource', 'ws-1', 'src-custom'],
    ['replaceIngressSecret', 'ws-1', 'src-custom', 'fixture-rotated-custom-ciphertext'],
  ]);
  const body = await response.json();
  assert.equal(body.oneTimeSigningSecret, 'fixture-rotated-custom-secret');
  assert.equal(JSON.stringify(body.source).includes('fixture-rotated-custom-secret'), false);
  assert.equal(JSON.stringify(body).includes('fixture-rotated-custom-ciphertext'), false);
});
