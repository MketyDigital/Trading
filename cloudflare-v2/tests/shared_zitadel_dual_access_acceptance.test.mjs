import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';
import { handleAuthorizedV1AdminMembersRequest } from '../src/http/v1_admin_members.js';
import { authorizeTradingClaims } from '../src/security/zitadel_auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function request(workspaceId, token = 'token') {
  return new Request('https://trade.test/api/v1/admin/workspace', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Mkety-Workspace-Id': workspaceId,
    },
  });
}

function entitlementSupabase(workspaces) {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      let id;
      return {
        select() { return this; },
        eq(column, value) {
          assert.equal(column, 'id');
          id = String(value);
          return this;
        },
        async maybeSingle() {
          const workspace = workspaces[id];
          return { data: workspace || null, error: null };
        },
      };
    },
  };
}

function membershipFactory(rows, calls = []) {
  return () => ({
    async getMembership(workspaceId, subject) {
      calls.push(['getMembership', String(workspaceId), String(subject)]);
      const row = rows[`${workspaceId}:${subject}`];
      return row ? { ...row } : null;
    },
  });
}

function claimsAuthenticator(claimsByToken) {
  return async (req, { requiredRole, workspace, projectId }) => {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/, '') || '';
    const claims = claimsByToken[token] || {};
    return authorizeTradingClaims(claims, { requiredRole, workspace, projectId });
  };
}

function workspace(id = 'ws-1', org = 'org-1') {
  return {
    id,
    display_name: id,
    owner_email: null,
    zitadel_org_id: org,
    trading_access_enabled: true,
    trading_required_role: 'trading_access',
  };
}

function member(workspaceId, subject, role = 'viewer', enabled = true) {
  return { workspaceId, subject, role, enabled, metadata: {} };
}

function projectClaims(subject, org = 'org-1', projectId = 'trading-project') {
  return {
    sub: subject,
    [`urn:zitadel:iam:org:project:${projectId}:roles`]: {
      trading_access: { [org]: 'org-domain' },
    },
  };
}

async function authorize({
  token,
  workspaceId = 'ws-1',
  workspaces = { 'ws-1': workspace('ws-1', 'org-1'), 'ws-2': workspace('ws-2', 'org-2') },
  claimsByToken,
  memberships,
  membershipCalls = [],
}) {
  return authorizeV1AdminRequest(request(workspaceId, token), {
    ZITADEL_PROJECT_ID: 'trading-project',
  }, {
    supabase: entitlementSupabase(workspaces),
    authenticateFn: claimsAuthenticator(claimsByToken),
    membershipStoreFactory: membershipFactory(memberships, membershipCalls),
  });
}

test('existing Mkety logical user and Trading-only logical user converge on the same Zitadel sub membership gate', async () => {
  const memberships = {
    'ws-1:user-1': member('ws-1', 'user-1', 'admin', true),
    'ws-1:user-2': member('ws-1', 'user-2', 'operator', true),
  };
  const claimsByToken = {
    existing: projectClaims('user-1'),
    tradingOnly: projectClaims('user-2'),
  };

  const existing = await authorize({ token: 'existing', claimsByToken, memberships });
  const tradingOnly = await authorize({ token: 'tradingOnly', claimsByToken, memberships });

  assert.equal(existing.ok, true);
  assert.equal(existing.auth.subject, 'user-1');
  assert.equal(existing.membership.role, 'admin');
  assert.equal(tradingOnly.ok, true);
  assert.equal(tradingOnly.auth.subject, 'user-2');
  assert.equal(tradingOnly.membership.role, 'operator');
});

test('authenticated subject without exact Trading membership fails closed', async () => {
  const result = await authorize({
    token: 'missing',
    claimsByToken: { missing: projectClaims('user-missing') },
    memberships: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
});

test('wrong Trading project claim fails before membership lookup', async () => {
  const membershipCalls = [];
  const result = await authorize({
    token: 'wrong-project',
    claimsByToken: {
      'wrong-project': {
        sub: 'user-1',
        'urn:zitadel:iam:org:project:other-project:roles': {
          trading_access: { 'org-1': 'org-domain' },
        },
        'urn:zitadel:iam:org:project:roles': {
          trading_access: { 'org-1': 'org-domain' },
        },
      },
    },
    memberships: { 'ws-1:user-1': member('ws-1', 'user-1', 'owner', true) },
    membershipCalls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG');
  assert.deepEqual(membershipCalls, []);
});

test('right Trading project but wrong organization fails before membership lookup', async () => {
  const membershipCalls = [];
  const result = await authorize({
    token: 'wrong-org',
    claimsByToken: { 'wrong-org': projectClaims('user-1', 'org-foreign') },
    memberships: { 'ws-1:user-1': member('ws-1', 'user-1', 'owner', true) },
    membershipCalls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ROLE_NOT_GRANTED_FOR_WORKSPACE_ORG');
  assert.deepEqual(membershipCalls, []);
});

test('membership in another Trading workspace never authorizes the selected workspace', async () => {
  const calls = [];
  const result = await authorize({
    token: 'user-1',
    claimsByToken: { 'user-1': projectClaims('user-1') },
    memberships: { 'ws-2:user-1': member('ws-2', 'user-1', 'owner', true) },
    membershipCalls: calls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
  assert.deepEqual(calls, [['getMembership', 'ws-1', 'user-1']]);
});

test('disabled member is rejected without affecting another enabled member in the same workspace', async () => {
  const claimsByToken = {
    disabled: projectClaims('user-disabled'),
    enabled: projectClaims('user-enabled'),
  };
  const memberships = {
    'ws-1:user-disabled': member('ws-1', 'user-disabled', 'admin', false),
    'ws-1:user-enabled': member('ws-1', 'user-enabled', 'viewer', true),
  };

  const disabled = await authorize({ token: 'disabled', claimsByToken, memberships });
  const enabled = await authorize({ token: 'enabled', claimsByToken, memberships });

  assert.equal(disabled.ok, false);
  assert.equal(disabled.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
  assert.equal(enabled.ok, true);
  assert.equal(enabled.membership.subject, 'user-enabled');
});

test('two subjects in one workspace keep independent Trading roles', async () => {
  const claimsByToken = {
    owner: projectClaims('owner-sub'),
    viewer: projectClaims('viewer-sub'),
  };
  const memberships = {
    'ws-1:owner-sub': member('ws-1', 'owner-sub', 'owner', true),
    'ws-1:viewer-sub': member('ws-1', 'viewer-sub', 'viewer', true),
  };

  const owner = await authorize({ token: 'owner', claimsByToken, memberships });
  const viewer = await authorize({ token: 'viewer', claimsByToken, memberships });

  assert.equal(owner.membership.role, 'owner');
  assert.equal(viewer.membership.role, 'viewer');
});

test('Trading authorization modules contain no MKSaaS database or shared Mkety workspace-table dependency', async () => {
  const files = [
    'src/http/v1_admin.js',
    'src/http/v1_admin_members.js',
    'src/security/trading_membership_store.js',
    'src/security/trading_permissions.js',
    'src/security/zitadel_auth.js',
  ];
  for (const relative of files) {
    const source = await readFile(resolve(root, relative), 'utf8');
    assert.equal(source.includes('MketyDigital/Mkety'), false, relative);
    assert.equal(source.includes(".from('workspaces')"), false, relative);
    assert.equal(source.includes('.from("workspaces")'), false, relative);
    assert.equal(/mksaas/i.test(source), false, relative);
  }
});

test('membership provisioning touches membership state only and no source/destination/account execution state', async () => {
  const calls = [];
  const membershipStore = {
    async getMembership(workspaceId, subject) {
      calls.push(['getMembership', workspaceId, subject]);
      return null;
    },
    async upsertMembership(workspaceId, subject, role) {
      calls.push(['upsertMembership', workspaceId, subject, role]);
      return member(workspaceId, subject, role, true);
    },
  };
  const req = new Request('https://trade.test/api/v1/admin/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: 'trading-only-sub', role: 'viewer' }),
  });
  const authorization = {
    workspace: { id: 'ws-1' },
    auth: { subject: 'owner-sub' },
    membership: member('ws-1', 'owner-sub', 'owner', true),
  };

  const response = await handleAuthorizedV1AdminMembersRequest(req, authorization, { membershipStore });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['upsertMembership', 'ws-1', 'trading-only-sub', 'viewer']]);
});

test('operator identity document exists and states shared-Zitadel identity, Trading membership entitlement, and separate broker execution', async () => {
  const doc = await readFile(resolve(root, 'docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md'), 'utf8');
  assert.match(doc, /one managed Mkety Zitadel instance/i);
  assert.match(doc, /MKSaaS project\/app/i);
  assert.match(doc, /Trading project\/app/i);
  assert.match(doc, /trading_workspace_memberships/i);
  assert.match(doc, /identity/i);
  assert.match(doc, /membership.*entitlement/is);
  assert.match(doc, /broker execution.*separate/is);
  assert.match(doc, /Trading-only/i);
}
);
