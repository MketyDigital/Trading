import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';

const env = {
  ZITADEL_ISSUER: 'https://login.example',
  ZITADEL_AUDIENCE: 'trading-api',
  ZITADEL_JWKS_URL: 'https://login.example/oauth/v2/keys',
  ZITADEL_PROJECT_ID: 'trading-project',
};

const workspace = {
  id: 'ws-1',
  zitadel_org_id: 'org-1',
  trading_access_enabled: true,
  trading_required_role: 'trading_access',
};

function request(workspaceId = 'ws-1') {
  return new Request('https://trade.test/api/v1/admin/workspace', {
    headers: {
      'X-Mkety-Workspace-Id': workspaceId,
      Authorization: 'Bearer token',
    },
  });
}

function makeSupabase({ membership = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      if (table === 'trading_workspace_access') {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          maybeSingle: async () => ({ data: workspace, error: null }),
        };
        return chain;
      }
      if (table === 'trading_workspace_memberships') {
        const chain = {
          select() { return chain; },
          eq(column, value) { calls.push(['membership_eq', column, value]); return chain; },
          maybeSingle: async () => ({ data: membership, error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const authenticate = async () => ({
  ok: true,
  subject: 'zitadel-user-1',
  workspaceId: 'ws-1',
  organizationId: 'org-1',
  role: 'trading_access',
});

test('valid Zitadel identity is denied when exact Trading membership is missing', async () => {
  const result = await authorizeV1AdminRequest(request(), env, {
    supabase: makeSupabase(),
    authenticateFn: authenticate,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
});

test('enabled exact workspace membership authorizes the Trading-only Zitadel subject', async () => {
  const supabase = makeSupabase({ membership: {
    id: 'membership-1',
    workspace_id: 'ws-1',
    zitadel_subject: 'zitadel-user-1',
    trading_role: 'operator',
    membership_enabled: true,
    metadata: {},
  } });

  const result = await authorizeV1AdminRequest(request(), env, {
    supabase,
    authenticateFn: authenticate,
  });
  assert.equal(result.ok, true);
  assert.equal(result.auth.subject, 'zitadel-user-1');
  assert.equal(result.membership.workspaceId, 'ws-1');
  assert.equal(result.membership.subject, 'zitadel-user-1');
  assert.equal(result.membership.role, 'operator');
  assert.deepEqual(supabase.calls.filter((call) => call[0] === 'membership_eq'), [
    ['membership_eq', 'workspace_id', 'ws-1'],
    ['membership_eq', 'zitadel_subject', 'zitadel-user-1'],
  ]);
});

test('disabled membership is denied without consulting any MKSaaS user database', async () => {
  const supabase = makeSupabase({ membership: {
    id: 'membership-1',
    workspace_id: 'ws-1',
    zitadel_subject: 'zitadel-user-1',
    trading_role: 'viewer',
    membership_enabled: false,
    metadata: {},
  } });

  const result = await authorizeV1AdminRequest(request(), env, {
    supabase,
    authenticateFn: authenticate,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
  assert.equal(supabase.calls.some((call) => String(call[1] || '').includes('users')), false);
  assert.equal(supabase.calls.some((call) => String(call[1] || '').includes('workspaces') && call[1] !== 'trading_workspace_access'), false);
});
