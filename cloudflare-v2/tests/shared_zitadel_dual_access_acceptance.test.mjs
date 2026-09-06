import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';
import { handleAuthorizedV1AdminMembersRequest } from '../src/http/v1_admin_members.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

function request(workspaceId, token = 'token') {
  return new Request('https://trade.mkety.com/api/v1/admin/workspace', {
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
          return { data: workspaces[id] || null, error: null };
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

function assertionAuthenticator(assertionsByToken) {
  return async (req, { requestedWorkspaceId }) => {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/, '') || '';
    const assertion = assertionsByToken[token];
    if (!assertion) return { ok: false, reason: 'MALFORMED_TOKEN' };
    if (assertion.product !== 'trading') return { ok: false, reason: 'WRONG_PRODUCT' };
    if (String(assertion.workspace_id) !== String(requestedWorkspaceId)) {
      return { ok: false, reason: 'WORKSPACE_ASSERTION_MISMATCH' };
    }
    if (assertion.access !== 'owner') return { ok: false, reason: 'OWNER_ACCESS_REQUIRED' };
    return {
      ok: true,
      subject: String(assertion.sub),
      workspaceId: String(assertion.workspace_id),
      access: 'owner',
      claims: assertion,
    };
  };
}

function workspace(id = 'ws-1') {
  return { id, display_name: id, owner_email: null, trading_access_enabled: true };
}

function member(workspaceId, subject, role = 'owner', enabled = true) {
  return { workspaceId, subject, role, enabled, metadata: {} };
}

function assertion(subject, workspaceId = 'ws-1', overrides = {}) {
  return {
    sub: subject,
    product: 'trading',
    workspace_id: workspaceId,
    access: 'owner',
    ...overrides,
  };
}

async function authorize({
  token,
  workspaceId = 'ws-1',
  workspaces = { 'ws-1': workspace('ws-1'), 'ws-2': workspace('ws-2') },
  assertionsByToken,
  memberships,
  membershipCalls = [],
}) {
  return authorizeV1AdminRequest(request(workspaceId, token), {}, {
    supabase: entitlementSupabase(workspaces),
    authenticateFn: assertionAuthenticator(assertionsByToken),
    membershipStoreFactory: membershipFactory(memberships, membershipCalls),
  });
}

test('existing Mkety user and Trading-only user converge on the same signed Trading assertion plus Supabase membership gate', async () => {
  const memberships = {
    'ws-1:user-1': member('ws-1', 'user-1'),
    'ws-1:user-2': member('ws-1', 'user-2'),
  };
  const assertionsByToken = {
    existing: assertion('user-1'),
    tradingOnly: assertion('user-2'),
  };

  const existing = await authorize({ token: 'existing', assertionsByToken, memberships });
  const tradingOnly = await authorize({ token: 'tradingOnly', assertionsByToken, memberships });

  assert.equal(existing.ok, true);
  assert.equal(existing.auth.subject, 'user-1');
  assert.equal(tradingOnly.ok, true);
  assert.equal(tradingOnly.auth.subject, 'user-2');
});

test('authenticated subject without exact Trading membership fails closed', async () => {
  const result = await authorize({
    token: 'missing',
    assertionsByToken: { missing: assertion('user-missing') },
    memberships: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
});

test('wrong product assertion fails before membership lookup', async () => {
  const membershipCalls = [];
  const result = await authorize({
    token: 'wrong-product',
    assertionsByToken: { 'wrong-product': assertion('user-1', 'ws-1', { product: 'mksaas' }) },
    memberships: { 'ws-1:user-1': member('ws-1', 'user-1') },
    membershipCalls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WRONG_PRODUCT');
  assert.deepEqual(membershipCalls, []);
});

test('assertion for another Trading workspace fails before membership lookup', async () => {
  const membershipCalls = [];
  const result = await authorize({
    token: 'wrong-workspace',
    assertionsByToken: { 'wrong-workspace': assertion('user-1', 'ws-2') },
    memberships: { 'ws-1:user-1': member('ws-1', 'user-1') },
    membershipCalls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WORKSPACE_ASSERTION_MISMATCH');
  assert.deepEqual(membershipCalls, []);
});

test('non-owner assertion fails before membership lookup', async () => {
  const membershipCalls = [];
  const result = await authorize({
    token: 'viewer',
    assertionsByToken: { viewer: assertion('user-1', 'ws-1', { access: 'viewer' }) },
    memberships: { 'ws-1:user-1': member('ws-1', 'user-1') },
    membershipCalls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'OWNER_ACCESS_REQUIRED');
  assert.deepEqual(membershipCalls, []);
});

test('membership in another Trading workspace never authorizes the selected workspace', async () => {
  const calls = [];
  const result = await authorize({
    token: 'user-1',
    assertionsByToken: { 'user-1': assertion('user-1') },
    memberships: { 'ws-2:user-1': member('ws-2', 'user-1') },
    membershipCalls: calls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
  assert.deepEqual(calls, [['getMembership', 'ws-1', 'user-1']]);
});

test('disabled membership revokes access even while the signed assertion is otherwise valid', async () => {
  const result = await authorize({
    token: 'disabled',
    assertionsByToken: { disabled: assertion('user-disabled') },
    memberships: { 'ws-1:user-disabled': member('ws-1', 'user-disabled', 'owner', false) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING');
});

test('Trading authorization modules contain no MKSaaS database or shared Mkety workspace-table dependency', async () => {
  const files = [
    'src/http/v1_admin.js',
    'src/http/v1_admin_members.js',
    'src/security/trading_membership_store.js',
    'src/security/trading_permissions.js',
    'src/security/mkety_access_assertion.js',
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
    async getMembership() { return null; },
    async upsertMembership(workspaceId, subject, role) {
      calls.push(['upsertMembership', workspaceId, subject, role]);
      return member(workspaceId, subject, role, true);
    },
  };
  const req = new Request('https://trade.mkety.com/api/v1/admin/members', {
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
