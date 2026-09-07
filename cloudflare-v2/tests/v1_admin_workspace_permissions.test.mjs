import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminRequest } from '../src/http/v1_admin.js';

const workspace = {
  id: 'ws-1',
  display_name: 'Enterprise One',
  zitadel_org_id: 'org-1',
  trading_access_enabled: true,
  trading_required_role: 'trading_access',
};

function supabase() {
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

function request() {
  return new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: { 'X-Mkety-Workspace-Id': 'ws-1', Authorization: 'Bearer token' },
  });
}

function membership(role) {
  return () => ({
    async getMembership() {
      return { id: 'm-1', workspaceId: 'ws-1', subject: 'u-1', role, enabled: true, metadata: {} };
    },
  });
}

test('unknown workspace role cannot read workspace admin endpoint', async () => {
  const response = await handleV1AdminRequest(request(), {}, {
    supabaseFactory: async () => supabase(),
    authenticateFn: async () => ({ ok: true, subject: 'u-1', workspaceId: 'ws-1' }),
    membershipStoreFactory: membership('unknown'),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'TRADING_PERMISSION_DENIED');
});

test('viewer may read workspace metadata without gaining write or broker permissions', async () => {
  const response = await handleV1AdminRequest(request(), {}, {
    supabaseFactory: async () => supabase(),
    authenticateFn: async () => ({ ok: true, subject: 'u-1', workspaceId: 'ws-1' }),
    membershipStoreFactory: membership('viewer'),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).workspace.id, 'ws-1');
});
