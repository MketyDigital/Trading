import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';

const env = {
  TRADING_CUSTOM_HOSTNAMES_ENABLED: 'true',
  TRADING_CANONICAL_HOSTS: 'trade.mkety.com',
  MKETY_ACCESS_ISSUER: 'https://access.mkety.example',
  MKETY_ACCESS_AUDIENCE: 'mkety-trading',
  MKETY_ACCESS_JWKS_URL: 'https://access.mkety.example/.well-known/jwks.json',
};

function workspaceSupabase(workspace) {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle: async () => ({ data: workspace, error: null }),
      };
      return chain;
    },
  };
}

function membershipStore() {
  return {
    async getMembership(workspaceId, subject) {
      return { id: 'm1', workspaceId, subject, role: 'owner', enabled: true, metadata: {} };
    },
  };
}

test('active customer hostname cannot authorize a different selected workspace', async () => {
  let authenticateCalled = false;
  const request = new Request('https://trade.customer.example/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-2', Authorization: 'Bearer token' },
  });

  const result = await authorizeV1AdminRequest(request, env, {
    supabase: workspaceSupabase({ id: 'ws-2', trading_access_enabled: true }),
    hostnameStoreFactory: () => ({
      async getActiveHostname() {
        return { hostname: 'trade.customer.example', workspaceId: 'ws-1', status: 'active', verifiedAt: '2026-09-05T00:00:00Z' };
      },
    }),
    authenticateFn: async () => {
      authenticateCalled = true;
      return { ok: true, subject: 'owner-1', workspaceId: 'ws-2', access: 'owner' };
    },
    membershipStoreFactory: () => membershipStore(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'TRADING_HOSTNAME_WORKSPACE_MISMATCH');
  assert.equal(authenticateCalled, false);
});

test('active customer hostname and signed assertion may converge on the same workspace', async () => {
  const request = new Request('https://trade.customer.example/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' },
  });

  const result = await authorizeV1AdminRequest(request, env, {
    supabase: workspaceSupabase({ id: 'ws-1', trading_access_enabled: true }),
    hostnameStoreFactory: () => ({
      async getActiveHostname() {
        return { hostname: 'trade.customer.example', workspaceId: 'ws-1', status: 'active', verifiedAt: '2026-09-05T00:00:00Z' };
      },
    }),
    authenticateFn: async () => ({ ok: true, subject: 'owner-1', workspaceId: 'ws-1', access: 'owner' }),
    membershipStoreFactory: () => membershipStore(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.workspace.id, 'ws-1');
  assert.equal(result.auth.subject, 'owner-1');
});

test('canonical trade.mkety.com stays shared and relies on signed assertion plus Supabase workspace authority', async () => {
  let hostnameLookupCalled = false;
  const request = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-9', Authorization: 'Bearer token' },
  });

  const result = await authorizeV1AdminRequest(request, env, {
    supabase: workspaceSupabase({ id: 'ws-9', trading_access_enabled: true }),
    hostnameStoreFactory: () => ({
      async getActiveHostname() {
        hostnameLookupCalled = true;
        return null;
      },
    }),
    authenticateFn: async () => ({ ok: true, subject: 'owner-9', workspaceId: 'ws-9', access: 'owner' }),
    membershipStoreFactory: () => membershipStore(),
  });

  assert.equal(result.ok, true);
  assert.equal(hostnameLookupCalled, false);
});
