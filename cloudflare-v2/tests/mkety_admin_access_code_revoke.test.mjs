import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMketyAdminAccessCodesRequest } from '../src/http/v1_mkety_admin_access_codes.js';

const env = { MKETY_TRADING_ADMIN_SECRET: 'TEST_ADMIN_SECRET' };

function request(path, method = 'POST') {
  return new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: { Authorization: 'Bearer TEST_ADMIN_SECRET' },
  });
}

test('Mkety admin can revoke an access code without exposing code material', async () => {
  const calls = [];
  const store = {
    async revokeAccessCode(id) {
      calls.push(id);
      return {
        id,
        workspace_id: 'workspace-1',
        workspace_display_name: 'Starpips Trading',
        owner_email: 'owner@example.com',
        owner_name: 'Owner Example',
        status: 'revoked',
        max_redemptions: 1,
        redeemed_count: 0,
        entitlements: { liveExecution: false },
        metadata: {},
      };
    },
  };

  const response = await handleMketyAdminAccessCodesRequest(
    request('/api/v1/mkety-admin/access-codes/code-row-1/revoke'),
    env,
    { store }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.accessCode.status, 'revoked');
  assert.equal(body.accessCode.codeHash, undefined);
  assert.equal(body.accessCode.plainCode, undefined);
  assert.deepEqual(calls, ['code-row-1']);
});

test('Mkety admin revoke requires a concrete access code id', async () => {
  const response = await handleMketyAdminAccessCodesRequest(
    request('/api/v1/mkety-admin/access-codes//revoke'),
    env,
    { store: { async revokeAccessCode() { throw new Error('must not run'); } } }
  );

  assert.equal(response.status, 404);
});
