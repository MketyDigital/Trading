import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorizedV1AdminMembersRequest } from '../src/http/v1_admin_members.js';

function request(path, { method = 'GET', body } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(`https://trade.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authorization(role = 'admin', workspaceId = 'ws-1') {
  return {
    workspace: { id: workspaceId },
    auth: { subject: 'caller-sub' },
    membership: { workspaceId, subject: 'caller-sub', role, enabled: true },
  };
}

function member(subject, role = 'viewer', enabled = true, workspaceId = 'ws-1') {
  return {
    id: `${workspaceId}:${subject}`,
    workspaceId,
    subject,
    role,
    enabled,
    metadata: {},
    createdAt: '2026-09-02T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };
}

function makeStore(initial = []) {
  const rows = initial.map((item) => ({ ...item }));
  const calls = [];
  const find = (workspaceId, subject) => rows.find((item) => item.workspaceId === workspaceId && item.subject === subject) || null;
  return {
    calls,
    async listMemberships(workspaceId) {
      calls.push(['listMemberships', workspaceId]);
      return rows.filter((item) => item.workspaceId === workspaceId).map((item) => ({ ...item }));
    },
    async getMembership(workspaceId, subject) {
      calls.push(['getMembership', workspaceId, subject]);
      const found = find(workspaceId, subject);
      return found ? { ...found } : null;
    },
    async upsertMembership(workspaceId, subject, role) {
      calls.push(['upsertMembership', workspaceId, subject, role]);
      let found = find(workspaceId, subject);
      if (!found) {
        found = member(subject, role, true, workspaceId);
        rows.push(found);
      } else {
        found.role = role;
        found.enabled = true;
      }
      return { ...found };
    },
    async setMembershipRole(workspaceId, subject, role) {
      calls.push(['setMembershipRole', workspaceId, subject, role]);
      const found = find(workspaceId, subject);
      if (!found) return null;
      found.role = role;
      return { ...found };
    },
    async setMembershipEnabled(workspaceId, subject, enabled) {
      calls.push(['setMembershipEnabled', workspaceId, subject, enabled]);
      const found = find(workspaceId, subject);
      if (!found) return null;
      found.enabled = enabled;
      return { ...found };
    },
    async countEnabledOwners(workspaceId) {
      calls.push(['countEnabledOwners', workspaceId]);
      return rows.filter((item) => item.workspaceId === workspaceId && item.role === 'owner' && item.enabled).length;
    },
  };
}

test('owner/admin list only the authenticated workspace and response exposes safe membership fields', async () => {
  const store = makeStore([
    member('owner-1', 'owner', true, 'ws-1'),
    member('viewer-1', 'viewer', true, 'ws-1'),
    member('foreign', 'admin', true, 'ws-2'),
  ]);
  const response = await handleAuthorizedV1AdminMembersRequest(
    request('/api/v1/admin/members'), authorization('admin'), { membershipStore: store }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.workspaceId, 'ws-1');
  assert.deepEqual(body.members.map((item) => item.subject), ['owner-1', 'viewer-1']);
  assert.equal(JSON.stringify(body).includes('ws-2'), false);
  assert.deepEqual(store.calls, [['listMemberships', 'ws-1']]);
});

test('owner can add a Trading-only Zitadel subject without any MKSaaS identity lookup', async () => {
  const store = makeStore([member('caller-sub', 'owner')]);
  const response = await handleAuthorizedV1AdminMembersRequest(
    request('/api/v1/admin/members', {
      method: 'POST',
      body: { subject: 'trading-only-sub', role: 'operator', workspaceId: 'ws-evil', email: 'not-authority@example.com' },
    }),
    authorization('owner'),
    { membershipStore: store }
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.member.subject, 'trading-only-sub');
  assert.equal(body.member.role, 'operator');
  assert.deepEqual(store.calls.at(-1), ['upsertMembership', 'ws-1', 'trading-only-sub', 'operator']);
  assert.equal(store.calls.some((call) => call.includes('ws-evil')), false);
});

test('same Zitadel subject may belong independently to two Trading workspaces', async () => {
  const store = makeStore([
    member('shared-sub', 'viewer', true, 'ws-2'),
    member('caller-sub', 'owner', true, 'ws-1'),
  ]);
  const response = await handleAuthorizedV1AdminMembersRequest(
    request('/api/v1/admin/members', { method: 'POST', body: { subject: 'shared-sub', role: 'admin' } }),
    authorization('owner', 'ws-1'),
    { membershipStore: store }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(store.calls.at(-1), ['upsertMembership', 'ws-1', 'shared-sub', 'admin']);
  const foreign = await store.getMembership('ws-2', 'shared-sub');
  assert.equal(foreign.role, 'viewer');
});

test('operator/viewer cannot mutate members and denial occurs before store mutation', async () => {
  for (const role of ['operator', 'viewer']) {
    const store = makeStore([member('target', 'viewer')]);
    const response = await handleAuthorizedV1AdminMembersRequest(
      request('/api/v1/admin/members/target/role', { method: 'POST', body: { role: 'admin' } }),
      authorization(role),
      { membershipStore: store }
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'TRADING_PERMISSION_DENIED');
    assert.deepEqual(store.calls, []);
  }
});

test('invalid role fails closed before membership mutation', async () => {
  const store = makeStore();
  const response = await handleAuthorizedV1AdminMembersRequest(
    request('/api/v1/admin/members', { method: 'POST', body: { subject: 'u-2', role: 'superadmin' } }),
    authorization('admin'),
    { membershipStore: store }
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'INVALID_TRADING_ROLE');
  assert.deepEqual(store.calls, []);
});

test('last enabled owner cannot be disabled or demoted', async () => {
  for (const [path, body] of [
    ['/api/v1/admin/members/owner-1/disable', undefined],
    ['/api/v1/admin/members/owner-1/role', { role: 'admin' }],
  ]) {
    const store = makeStore([member('owner-1', 'owner', true)]);
    const response = await handleAuthorizedV1AdminMembersRequest(
      request(path, { method: 'POST', body }), authorization('owner'), { membershipStore: store }
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).reason, 'LAST_WORKSPACE_OWNER');
    assert.equal(store.calls.some((call) => call[0] === 'setMembershipEnabled' || call[0] === 'setMembershipRole'), false);
  }
});

test('one owner may be disabled when another enabled owner remains', async () => {
  const store = makeStore([
    member('owner-1', 'owner', true),
    member('owner-2', 'owner', true),
  ]);
  const response = await handleAuthorizedV1AdminMembersRequest(
    request('/api/v1/admin/members/owner-2/disable', { method: 'POST' }), authorization('owner'), { membershipStore: store }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(store.calls.at(-1), ['setMembershipEnabled', 'ws-1', 'owner-2', false]);
});

test('member actions cannot cross the authenticated workspace', async () => {
  const store = makeStore([member('foreign', 'admin', true, 'ws-2')]);
  const response = await handleAuthorizedV1AdminMembersRequest(
    request('/api/v1/admin/members/foreign/disable', { method: 'POST', body: { workspaceId: 'ws-2' } }),
    authorization('admin', 'ws-1'),
    { membershipStore: store }
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).reason, 'TRADING_MEMBER_NOT_FOUND');
  assert.equal(store.calls.some((call) => call.includes('ws-2')), false);
});
