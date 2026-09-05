import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeV1AdminRequest, handleV1AdminRequest } from '../src/http/v1_admin.js';

const mketyAccessEnv = {
  MKETY_ACCESS_ISSUER: 'https://access.mkety.example',
  MKETY_ACCESS_AUDIENCE: 'mkety-trading',
  MKETY_ACCESS_JWKS_URL: 'https://access.mkety.example/.well-known/jwks.json',
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

function membership(subject = 'u1', role = 'owner', enabled = true) {
  return () => ({
    async getMembership(workspaceId, requestedSubject) {
      assert.equal(workspaceId, 'ws-1');
      assert.equal(requestedSubject, subject);
      return { id: 'membership-1', workspaceId: 'ws-1', subject, role, enabled, metadata: {} };
    },
  });
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
    supabase: workspaceQuery({ id: 'ws-1', trading_access_enabled: false }),
    authenticateFn: async () => ({ ok: true }),
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.status, 403);
  assert.equal(disabled.reason, 'TRADING_ACCESS_DISABLED');
});

test('admin authorization binds Mkety assertion to the exact Trading workspace and enabled Supabase membership', async () => {
  let authOptions;
  const request = new Request('https://trade.test/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' },
  });
  const result = await authorizeV1AdminRequest(request, mketyAccessEnv, {
    supabase: workspaceQuery({ id: 'ws-1', trading_access_enabled: true }),
    authenticateFn: async (_request, options) => {
      authOptions = options;
      return { ok: true, subject: 'u1', workspaceId: 'ws-1', access: 'owner' };
    },
    membershipStoreFactory: membership(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.workspace.id, 'ws-1');
  assert.equal(result.membership.subject, 'u1');
  assert.equal(authOptions.requestedWorkspaceId, 'ws-1');
  assert.equal(authOptions.audience, 'mkety-trading');
});

test('admin authorization rejects disabled Supabase membership after signed assertion succeeds', async () => {
  const request = new Request('https://trade.test/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' },
  });
  const result = await authorizeV1AdminRequest(request, mketyAccessEnv, {
    supabase: workspaceQuery({ id: 'ws-1', trading_access_enabled: true }),
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1', access: 'owner' }),
    membershipStoreFactory: membership('u1', 'owner', false),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
});

test('GET workspace returns only authenticated Trading access record and strips secrets/legacy identity binding', async () => {
  const workspace = {
    id: 'ws-1', display_name: 'Enterprise One', owner_email: 'owner@example.com', zitadel_org_id: 'legacy-org-1',
    trading_access_enabled: true, trading_required_role: 'legacy-role', tg_bot_token: 'secret-token',
  };
  const response = await handleV1AdminRequest(new Request('https://trade.test/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' },
  }), mketyAccessEnv, {
    supabaseFactory: async () => workspaceQuery(workspace),
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1', access: 'owner' }),
    membershipStoreFactory: membership(),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.workspace.id, 'ws-1');
  assert.equal(body.workspace.tg_bot_token, undefined);
  assert.equal(body.workspace.zitadel_org_id, undefined);
  assert.equal(body.workspace.trading_required_role, undefined);
  assert.equal(body.workspace.owner_email, 'owner@example.com');
});

test('generic legacy admin proxy paths are not exposed through V1 admin handler', async () => {
  const response = await handleV1AdminRequest(new Request('https://trade.test/api/v1/admin/proxy', {
    method: 'POST', headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' }, body: '{}',
  }), mketyAccessEnv, {
    supabaseFactory: async () => workspaceQuery({ id: 'ws-1', trading_access_enabled: true }),
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1', access: 'owner' }),
    membershipStoreFactory: membership(),
  });
  assert.equal(response.status, 404);
});
