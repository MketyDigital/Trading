import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleMketyAdminAccessCodesRequest,
  isSyntheticTestWorkspaceOwnerEmail,
} from '../src/http/v1_mkety_admin_access_codes.js';

test('synthetic workspace predicate is narrow and never matches real Starpips or Mkay owners', () => {
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('frontend-e2e-34903273147@example.test'), true);
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('connection-readiness-34903273158@example.test'), true);
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('gateway-config-probe-34683996932@example.test'), true);
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('diag-redemption@example.test'), true);
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('e2e-owner@starpips.test'), true);
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('fxhighpriest01@gmail.com'), false);
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('mkpoikankes@gmail.com'), false);
  assert.equal(isSyntheticTestWorkspaceOwnerEmail('frontend-e2e-owner@gmail.com'), false);
});

test('staff-secret protected purge route delegates only through the synthetic purge method', async () => {
  const calls = [];
  const store = {
    async purgeSyntheticWorkspace(id) {
      calls.push(id);
      return { id, deleted: true, ownerEmail: 'frontend-e2e-123@example.test' };
    },
  };
  const response = await handleMketyAdminAccessCodesRequest(
    new Request('https://trade.mkety.com/api/v1/mkety-admin/access-codes/test-workspaces/11111111-1111-4111-8111-111111111111/purge', {
      method: 'POST',
      headers: { 'X-Mkety-Admin-Secret': 'secret' },
    }),
    { MKETY_TRADING_ADMIN_SECRET: 'secret' },
    { store },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['11111111-1111-4111-8111-111111111111']);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.workspace.deleted, true);
});

test('purge route remains private', async () => {
  const response = await handleMketyAdminAccessCodesRequest(
    new Request('https://trade.mkety.com/api/v1/mkety-admin/access-codes/test-workspaces/11111111-1111-4111-8111-111111111111/purge', { method: 'POST' }),
    { MKETY_TRADING_ADMIN_SECRET: 'secret' },
    { store: { purgeSyntheticWorkspace: async () => ({ deleted: true }) } },
  );
  assert.equal(response.status, 401);
});
