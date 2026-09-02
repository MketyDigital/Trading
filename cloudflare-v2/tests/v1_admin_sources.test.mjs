import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminRequest } from '../src/http/v1_admin.js';
import { handleAuthorizedV1AdminSourcesRequest } from '../src/http/v1_admin_sources.js';

const workspace = {
  id: 'ws-1',
  zitadel_org_id: 'org-1',
  trading_access_enabled: true,
  trading_required_role: 'trading_admin',
};

function request(path, { method = 'GET', body, workspaceId = 'ws-1' } = {}) {
  const headers = new Headers({
    'X-Mkety-Workspace-Id': workspaceId,
    Authorization: 'Bearer token',
  });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(`https://trade.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function source(overrides = {}) {
  return {
    id: 'src-a',
    workspaceId: 'ws-1',
    providerType: 'cloudflare_container_mtproto',
    sourceFamily: 'telegram',
    sourceType: 'telegram_mtproto',
    sourceInstanceId: 'tg-a',
    displayName: 'Telegram A',
    enabled: true,
    isDefault: true,
    priority: 10,
    externalIdentity: 'acct-a',
    config: { chat_ids: ['-1001'], session_string: 'must-strip', api_hash: 'must-strip' },
    health: { status: 'HEALTHY', lastErrorCode: null, restartCount: 1 },
    secret: 'must-strip',
    secret_ciphertext: 'must-strip',
    provider_secret_ciphertext: 'must-strip',
    sessionString: 'must-strip',
    accessToken: 'must-strip',
    ...overrides,
  };
}

function makeStore(sources = [source()]) {
  const calls = [];
  return {
    calls,
    async listSources(workspaceId) {
      calls.push(['listSources', workspaceId]);
      return sources.filter((item) => item.workspaceId === workspaceId);
    },
    async getSource(workspaceId, sourceId) {
      calls.push(['getSource', workspaceId, sourceId]);
      return sources.find((item) => item.workspaceId === workspaceId && item.id === sourceId) || null;
    },
    async setDefaultSource(workspaceId, sourceFamily, sourceId) {
      calls.push(['setDefaultSource', workspaceId, sourceFamily, sourceId]);
      const found = sources.find((item) => item.workspaceId === workspaceId && item.id === sourceId);
      if (!found || found.sourceFamily !== sourceFamily) throw new Error('source not enabled for workspace/family');
      return { ...found, isDefault: true };
    },
    async setSourceEnabled(workspaceId, sourceId, enabled) {
      calls.push(['setSourceEnabled', workspaceId, sourceId, enabled]);
      const found = sources.find((item) => item.workspaceId === workspaceId && item.id === sourceId);
      return found ? { ...found, enabled, isDefault: enabled ? found.isDefault : false } : null;
    },
  };
}

function authorizedRequest(req, store) {
  return handleAuthorizedV1AdminSourcesRequest(req, {
    workspace,
    auth: { subject: 'u-1' },
  }, { sourceStore: store });
}

test('authorized list is exact-workspace and strips every secret-like source/provider field', async () => {
  const store = makeStore([
    source(),
    source({ id: 'src-b', providerType: 'external_mtproto', isDefault: false, externalIdentity: 'acct-b', config: { chat_policy: { mode: 'allowlist', chat_ids: ['-2002'] }, token: 'must-strip' } }),
    source({ id: 'src-other', workspaceId: 'ws-2', externalIdentity: 'acct-other' }),
  ]);

  const response = await authorizedRequest(request('/api/v1/admin/sources'), store);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.workspaceId, 'ws-1');
  assert.deepEqual(body.sources.map((item) => item.id), ['src-a', 'src-b']);
  assert.deepEqual(store.calls, [['listSources', 'ws-1']]);

  const serialized = JSON.stringify(body);
  for (const forbidden of ['must-strip', 'secret_ciphertext', 'provider_secret_ciphertext', 'sessionString', 'api_hash', 'accessToken']) {
    assert.equal(serialized.includes(forbidden), false, `response leaked ${forbidden}`);
  }
  assert.deepEqual(body.sources[0].config, { chat_ids: ['-1001'] });
});

test('status lookup cannot cross workspace even when caller chooses another source id', async () => {
  const store = makeStore([
    source(),
    source({ id: 'src-other', workspaceId: 'ws-2', externalIdentity: 'acct-other' }),
  ]);

  const response = await authorizedRequest(request('/api/v1/admin/sources/src-other'), store);
  assert.equal(response.status, 404);
  assert.deepEqual(store.calls, [['getSource', 'ws-1', 'src-other']]);
});

test('set default uses authenticated workspace and exact family without mutating sibling families', async () => {
  const store = makeStore([
    source({ id: 'tg-a', isDefault: true }),
    source({ id: 'tg-b', providerType: 'external_mtproto', isDefault: false, externalIdentity: 'acct-b' }),
    source({ id: 'mt5-a', providerType: 'mt5_source_bridge', sourceFamily: 'mt5', isDefault: true, externalIdentity: 'mt5-acct' }),
  ]);

  const response = await authorizedRequest(request('/api/v1/admin/sources/tg-b/default', {
    method: 'POST',
    body: { sourceFamily: 'telegram', workspaceId: 'ws-evil' },
  }), store);
  assert.equal(response.status, 200);
  assert.deepEqual(store.calls, [['setDefaultSource', 'ws-1', 'telegram', 'tg-b']]);
  assert.equal(store.calls.some((call) => call.includes('mt5-a')), false);
  assert.equal(store.calls.some((call) => call.includes('ws-evil')), false);
});

test('enable and disable mutate only exact authenticated workspace/source', async () => {
  const store = makeStore([source({ id: 'src-a', isDefault: true })]);

  const disabled = await authorizedRequest(request('/api/v1/admin/sources/src-a/disable', {
    method: 'POST', body: { workspaceId: 'ws-evil' },
  }), store);
  assert.equal(disabled.status, 200);
  assert.deepEqual(store.calls[0], ['setSourceEnabled', 'ws-1', 'src-a', false]);
  assert.equal((await disabled.json()).source.isDefault, false);

  const enabled = await authorizedRequest(request('/api/v1/admin/sources/src-a/enable', { method: 'POST' }), store);
  assert.equal(enabled.status, 200);
  assert.deepEqual(store.calls[1], ['setSourceEnabled', 'ws-1', 'src-a', true]);
});

test('source admin auth failures from existing V1 gate stop before any source store access', async () => {
  let sourceStoreBuilt = 0;
  const baseWorkspace = { ...workspace };
  const makeSupabase = (record) => ({
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle: async () => ({ data: record, error: null }),
      };
      return chain;
    },
  });

  const cases = [
    {
      name: 'wrong org',
      record: baseWorkspace,
      authenticateFn: async () => ({ ok: false, reason: 'WORKSPACE_ORG_FORBIDDEN' }),
      expectedStatus: 403,
    },
    {
      name: 'missing trading role',
      record: baseWorkspace,
      authenticateFn: async () => ({ ok: false, reason: 'REQUIRED_ROLE_MISSING' }),
      expectedStatus: 403,
    },
    {
      name: 'disabled entitlement',
      record: { ...baseWorkspace, trading_access_enabled: false },
      authenticateFn: async () => ({ ok: true, subject: 'u-1' }),
      expectedStatus: 403,
    },
  ];

  for (const item of cases) {
    const response = await handleV1AdminRequest(request('/api/v1/admin/sources'), {}, {
      supabaseFactory: async () => makeSupabase(item.record),
      authenticateFn: item.authenticateFn,
      sourceStoreFactory: () => { sourceStoreBuilt += 1; return makeStore(); },
    });
    assert.equal(response.status, item.expectedStatus, item.name);
  }
  assert.equal(sourceStoreBuilt, 0);
});

test('unknown methods and malformed default requests fail closed without source mutation', async () => {
  const store = makeStore();
  const badMethod = await authorizedRequest(request('/api/v1/admin/sources', { method: 'DELETE' }), store);
  assert.equal(badMethod.status, 405);

  const badDefault = await authorizedRequest(request('/api/v1/admin/sources/src-a/default', {
    method: 'POST', body: { sourceFamily: '' },
  }), store);
  assert.equal(badDefault.status, 400);
  assert.deepEqual(store.calls, []);
});
