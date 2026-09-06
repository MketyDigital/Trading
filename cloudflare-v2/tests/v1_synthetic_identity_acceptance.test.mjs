import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeV1AdminRequest, handleV1AdminRequest } from '../src/http/v1_admin.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SUBJECT = 'mkety-user-123';

function workspaceSupabase({ enabled = true } = {}) {
  const workspace = {
    id: WORKSPACE_ID,
    display_name: 'Staging Trading Workspace',
    owner_email: 'owner@example.invalid',
    trading_access_enabled: enabled,
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
  };

  return {
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      return {
        select() { return this; },
        eq(column, value) {
          assert.equal(column, 'id');
          assert.equal(String(value), WORKSPACE_ID);
          return this;
        },
        async maybeSingle() {
          return { data: workspace, error: null };
        },
      };
    },
  };
}

function ownerMembershipStore() {
  return {
    async getMembership(workspaceId, subject) {
      assert.equal(String(workspaceId), WORKSPACE_ID);
      assert.equal(String(subject), SUBJECT);
      return {
        workspaceId: WORKSPACE_ID,
        subject: SUBJECT,
        role: 'owner',
        enabled: true,
      };
    },
  };
}

test('synthetic Mkety owner identity is accepted only through the server-owned authentication seam', async () => {
  const authCalls = [];
  const request = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: 'Bearer repository-acceptance-only',
      'X-Mkety-Workspace-Id': WORKSPACE_ID,
    },
  });

  const response = await handleV1AdminRequest(request, {}, {
    supabaseFactory: async () => workspaceSupabase(),
    authenticateFn: async (_request, options) => {
      authCalls.push(options);
      return {
        ok: true,
        subject: SUBJECT,
        workspaceId: WORKSPACE_ID,
        access: 'owner',
      };
    },
    membershipStoreFactory: () => ownerMembershipStore(),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(authCalls, [{
    issuer: undefined,
    audience: undefined,
    jwksUrl: undefined,
    requestedWorkspaceId: WORKSPACE_ID,
  }]);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.subject, SUBJECT);
  assert.equal(body.workspace.id, WORKSPACE_ID);
  assert.equal(body.workspace.trading_access_enabled, true);
});

test('selected workspace is bound into authentication before Trading workspace lookup', async () => {
  let databaseTouched = false;
  const request = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: 'Bearer repository-acceptance-only',
      'X-Mkety-Workspace-Id': WORKSPACE_ID,
    },
  });

  const result = await authorizeV1AdminRequest(request, {}, {
    supabase: {
      from() {
        databaseTouched = true;
        throw new Error('workspace lookup must not happen after auth mismatch');
      },
    },
    authenticateFn: async (_request, options) => {
      assert.equal(options.requestedWorkspaceId, WORKSPACE_ID);
      return {
        ok: true,
        subject: SUBJECT,
        workspaceId: '22222222-2222-4222-8222-222222222222',
        access: 'owner',
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'WORKSPACE_ASSERTION_MISMATCH');
  assert.equal(databaseTouched, false);
});

test('production Mkety verifier fails closed when issuer audience or JWKS configuration is missing', async () => {
  const request = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: 'Bearer not-a-real-token',
      'X-Mkety-Workspace-Id': WORKSPACE_ID,
    },
  });

  const result = await authorizeV1AdminRequest(request, {}, {
    supabase: workspaceSupabase(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(result.reason, 'MKETY_ACCESS_GATE_NOT_CONFIGURED');
});
