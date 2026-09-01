import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeV1AdminRequest, handleV1AdminRequest } from '../src/http/v1_admin.js';

const zitadelEnv = {
  ZITADEL_ISSUER: 'https://login.example',
  ZITADEL_AUDIENCE: 'trading-api',
  ZITADEL_JWKS_URL: 'https://login.example/oauth/v2/keys',
  ZITADEL_PROJECT_ID: 'project-1',
};

function workspaceQuery(workspace) {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      const chain = {
        select() { return chain; }, eq() { return chain; }, maybeSingle: async () => ({ data: workspace, error: null }),
        update() { return chain; },
      };
      return chain;
    },
  };
}

test('admin authorization fails closed without workspace selector or disabled entitlement', async () => {
  const missing = await authorizeV1AdminRequest(new Request('https://trade.test/api/v1/admin/workspace'), {}, {
    supabase: workspaceQuery(null), authenticateFn: async () => ({ ok: true }),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);

  const disabled = await authorizeV1AdminRequest(new Request('https://trade.test/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1' },
  }), {}, {
    supabase: workspaceQuery({ id: 'ws-1', zitadel_org_id: 'org-1', trading_access_enabled: false, trading_required_role: 'trading_access' }),
    authenticateFn: async () => ({ ok: true }),
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.status, 403);
  assert.equal(disabled.reason, 'TRADING_ACCESS_DISABLED');
});

test('admin authorization binds JWT role to exact Trading workspace Zitadel organization', async () => {
  let authOptions;
  const request = new Request('https://trade.test/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' },
  });
  const result = await authorizeV1AdminRequest(request, zitadelEnv, {
    supabase: workspaceQuery({ id: 'ws-1', zitadel_org_id: 'org-1', trading_access_enabled: true, trading_required_role: 'trading_admin' }),
    authenticateFn: async (_request, options) => { authOptions = options; return { ok: true, subject: 'u1', workspaceId: 'ws-1' }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.workspace.id, 'ws-1');
  assert.equal(authOptions.requiredRole, 'trading_admin');
  assert.equal(authOptions.workspace.zitadelOrgId, 'org-1');
  assert.equal(authOptions.audience, 'trading-api');
});

test('GET workspace returns only authenticated Trading access record and strips secrets', async () => {
  const workspace = {
    id: 'ws-1', display_name: 'Enterprise One', owner_email: 'owner@example.com', zitadel_org_id: 'org-1',
    trading_access_enabled: true, trading_required_role: 'trading_admin', tg_bot_token: 'secret-token',
  };
  const response = await handleV1AdminRequest(new Request('https://trade.test/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' },
  }), zitadelEnv, {
    supabaseFactory: async () => workspaceQuery(workspace),
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.workspace.id, 'ws-1');
  assert.equal(body.workspace.tg_bot_token, undefined);
  assert.equal(body.workspace.owner_email, 'owner@example.com');
});

test('generic legacy admin proxy paths are not exposed through V1 admin handler', async () => {
  const response = await handleV1AdminRequest(new Request('https://trade.test/api/v1/admin/proxy', {
    method: 'POST', headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' }, body: '{}',
  }), zitadelEnv, {
    supabaseFactory: async () => workspaceQuery({ id: 'ws-1', zitadel_org_id: 'org-1', trading_access_enabled: true, trading_required_role: 'trading_admin' }),
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1' }),
  });
  assert.equal(response.status, 404);
});
