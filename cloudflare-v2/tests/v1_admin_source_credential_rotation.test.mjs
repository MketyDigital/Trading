import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';

const authorization = {
  workspace: { id: 'ws-1' },
  auth: { subject: 'owner-1' },
  membership: { workspaceId: 'ws-1', subject: 'owner-1', role: 'owner', enabled: true },
};

function credentialRequest(sourceId, credentials) {
  return new Request(`https://trade.test/api/v1/admin/sources/${sourceId}/credentials`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials }),
  });
}

function makeStore(source) {
  const calls = [];
  return {
    calls,
    async getSource(workspaceId, sourceId) {
      calls.push(['getSource', workspaceId, sourceId]);
      if (workspaceId !== 'ws-1' || sourceId !== source.id) return null;
      return source;
    },
    async replaceSourceCredentials(workspaceId, sourceId, providerSecretCiphertext) {
      calls.push(['replaceSourceCredentials', workspaceId, sourceId, providerSecretCiphertext]);
      if (workspaceId !== 'ws-1' || sourceId !== source.id) return null;
      return { ...source, providerSecretCiphertext };
    },
  };
}

test('workspace owner rotates MT5 source credentials using an MT5-typed encrypted envelope', async () => {
  const source = {
    id: 'src-mt5',
    workspaceId: 'ws-1',
    providerType: 'mt5_source_bridge',
    sourceFamily: 'mt5',
    sourceType: 'mt5_account_stream',
    sourceInstanceId: 'mt5-primary',
    enabled: true,
    isDefault: true,
    priority: 20,
    config: { expectedServer: 'Broker-Live' },
    health: { status: 'HEALTHY', restartCount: 0 },
  };
  const store = makeStore(source);
  const encryptCalls = [];
  const credentials = {
    bridgeUrl: 'https://rotated-mt5-source.example',
    bridgeSecret: 'fixture-rotated-mt5-source-secret',
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    credentialRequest('src-mt5', credentials),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async (kind, value, masterKey) => {
        encryptCalls.push([kind, value, masterKey]);
        return 'fixture-rotated-mt5-envelope';
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(encryptCalls, [['mt5', credentials, 'fixture-master-key']]);
  assert.deepEqual(store.calls, [
    ['getSource', 'ws-1', 'src-mt5'],
    ['replaceSourceCredentials', 'ws-1', 'src-mt5', 'fixture-rotated-mt5-envelope'],
  ]);
  const serialized = JSON.stringify(await response.json());
  assert.equal(serialized.includes('fixture-rotated-mt5-source-secret'), false);
  assert.equal(serialized.includes('fixture-rotated-mt5-envelope'), false);
});

test('workspace owner rotates cTrader source credentials using a cTrader-typed encrypted envelope', async () => {
  const source = {
    id: 'src-ctrader',
    workspaceId: 'ws-1',
    providerType: 'ctrader_source',
    sourceFamily: 'ctrader',
    sourceType: 'ctrader_account_stream',
    sourceInstanceId: 'ctrader-primary',
    enabled: true,
    isDefault: true,
    priority: 30,
    config: { environment: 'live' },
    health: { status: 'HEALTHY', restartCount: 0 },
  };
  const store = makeStore(source);
  const encryptCalls = [];
  const credentials = {
    clientId: 'fixture-rotated-client-id',
    clientSecret: 'fixture-rotated-client-secret',
    accessToken: 'fixture-rotated-access-token',
    refreshToken: 'fixture-rotated-refresh-token',
  };

  const response = await handleAuthorizedV1AdminSourcesRequest(
    credentialRequest('src-ctrader', credentials),
    authorization,
    {
      sourceStore: store,
      env: { TRADING_MASTER_KEY: 'fixture-master-key' },
      encryptCredentials: async (kind, value, masterKey) => {
        encryptCalls.push([kind, value, masterKey]);
        return 'fixture-rotated-ctrader-envelope';
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(encryptCalls, [['ctrader', credentials, 'fixture-master-key']]);
  assert.deepEqual(store.calls, [
    ['getSource', 'ws-1', 'src-ctrader'],
    ['replaceSourceCredentials', 'ws-1', 'src-ctrader', 'fixture-rotated-ctrader-envelope'],
  ]);
  const serialized = JSON.stringify(await response.json());
  for (const forbidden of [
    'fixture-rotated-client-secret',
    'fixture-rotated-access-token',
    'fixture-rotated-refresh-token',
    'fixture-rotated-ctrader-envelope',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  }
});
