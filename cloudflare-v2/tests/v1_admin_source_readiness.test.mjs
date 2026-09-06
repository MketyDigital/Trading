import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';

const authorization = {
  workspace: { id: 'ws-1' },
  membership: { role: 'admin' },
};

function request(sourceId = 'src-1') {
  return new Request(`https://trade.test/api/v1/admin/sources/${sourceId}/enable`, {
    method: 'POST',
  });
}

function storeFor(source) {
  const calls = [];
  return {
    calls,
    async getSource(workspaceId, sourceId) {
      calls.push(['getSource', workspaceId, sourceId]);
      return source;
    },
    async setSourceEnabled(workspaceId, sourceId, enabled) {
      calls.push(['setSourceEnabled', workspaceId, sourceId, enabled]);
      return { ...source, enabled };
    },
  };
}

test('credential-backed source cannot be enabled before credentials are configured', async () => {
  const store = storeFor({
    id: 'src-1',
    providerType: 'mt5_source_bridge',
    sourceFamily: 'mt5',
    credentialConfigured: false,
    enabled: false,
  });

  const response = await handleAuthorizedV1AdminSourcesRequest(request(), authorization, {
    sourceStore: store,
    env: {},
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.reason, 'SOURCE_NOT_READY');
  assert.equal(body.readiness.reason, 'SOURCE_CREDENTIALS_NOT_CONFIGURED');
  assert.deepEqual(store.calls, [['getSource', 'ws-1', 'src-1']]);
});

test('tradingview source cannot be enabled before server transport is ready', async () => {
  const store = storeFor({
    id: 'tv-1',
    providerType: 'tradingview_webhook',
    sourceFamily: 'tradingview',
    publicSourceHandle: 'public-handle',
    enabled: false,
  });

  const response = await handleAuthorizedV1AdminSourcesRequest(request('tv-1'), authorization, {
    sourceStore: store,
    env: {},
  });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.reason, 'SOURCE_NOT_READY');
  assert.equal(body.readiness.reason, 'TRADINGVIEW_DIRECT_INGRESS_DISABLED');
  assert.deepEqual(store.calls, [['getSource', 'ws-1', 'tv-1']]);
});

test('tradingview production-capable activation path runs when gates are injected enabled', async () => {
  const fingerprint = 'ab'.repeat(32);
  const store = storeFor({
    id: 'tv-1',
    providerType: 'tradingview_webhook',
    sourceFamily: 'tradingview',
    publicSourceHandle: 'public-handle',
    enabled: false,
  });

  const response = await handleAuthorizedV1AdminSourcesRequest(request('tv-1'), authorization, {
    sourceStore: store,
    env: {
      TRADINGVIEW_DIRECT_INGRESS_ENABLED: 'true',
      TRADINGVIEW_TLS_CLIENT_CERT_SHA256: fingerprint,
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.source.enabled, true);
  assert.deepEqual(store.calls, [
    ['getSource', 'ws-1', 'tv-1'],
    ['setSourceEnabled', 'ws-1', 'tv-1', true],
  ]);
});
