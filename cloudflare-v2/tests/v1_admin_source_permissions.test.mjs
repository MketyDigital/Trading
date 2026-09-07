import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';

function request(path, { method = 'GET', body } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(`https://trade.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authorization(role) {
  return {
    workspace: { id: 'ws-1' },
    auth: { subject: 'u-1' },
    membership: { workspaceId: 'ws-1', subject: 'u-1', role, enabled: true },
  };
}

function store() {
  const calls = [];
  return {
    calls,
    async listSources(workspaceId) {
      calls.push(['listSources', workspaceId]);
      return [];
    },
    async getSource(workspaceId, sourceId) {
      calls.push(['getSource', workspaceId, sourceId]);
      return { id: sourceId, workspaceId, providerType: 'external_mtproto', sourceFamily: 'telegram', enabled: true };
    },
    async setDefaultSource(workspaceId, family, sourceId) {
      calls.push(['setDefaultSource', workspaceId, family, sourceId]);
      return { id: sourceId, workspaceId, providerType: 'external_mtproto', sourceFamily: family, enabled: true, isDefault: true };
    },
    async setSourceEnabled(workspaceId, sourceId, enabled) {
      calls.push(['setSourceEnabled', workspaceId, sourceId, enabled]);
      return { id: sourceId, workspaceId, providerType: 'external_mtproto', sourceFamily: 'telegram', enabled };
    },
  };
}

test('viewer can read sources but cannot mutate them', async () => {
  const sourceStore = store();
  const list = await handleAuthorizedV1AdminSourcesRequest(request('/api/v1/admin/sources'), authorization('viewer'), { sourceStore });
  assert.equal(list.status, 200);
  assert.deepEqual(sourceStore.calls, [['listSources', 'ws-1']]);

  for (const [path, body] of [
    ['/api/v1/admin/sources/src-a/disable', undefined],
    ['/api/v1/admin/sources/src-a/enable', undefined],
    ['/api/v1/admin/sources/src-a/default', { sourceFamily: 'telegram' }],
  ]) {
    const response = await handleAuthorizedV1AdminSourcesRequest(request(path, { method: 'POST', body }), authorization('viewer'), { sourceStore });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'TRADING_PERMISSION_DENIED');
  }
  assert.equal(sourceStore.calls.length, 1, 'viewer mutation must stop before source store mutation');
});

test('operator may mutate sources but remains scoped to authenticated workspace', async () => {
  const sourceStore = store();
  const response = await handleAuthorizedV1AdminSourcesRequest(request('/api/v1/admin/sources/src-a/disable', {
    method: 'POST',
    body: { workspaceId: 'ws-evil' },
  }), authorization('operator'), { sourceStore });

  assert.equal(response.status, 200);
  assert.deepEqual(sourceStore.calls, [['setSourceEnabled', 'ws-1', 'src-a', false]]);
});

test('unknown or missing workspace role fails closed before source access', async () => {
  for (const role of ['unknown', undefined]) {
    const sourceStore = store();
    const response = await handleAuthorizedV1AdminSourcesRequest(request('/api/v1/admin/sources'), authorization(role), { sourceStore });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'TRADING_PERMISSION_DENIED');
    assert.deepEqual(sourceStore.calls, []);
  }
});
