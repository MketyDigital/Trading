import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';

const env = {
  TRADING_CANONICAL_HOSTS: 'trade.mkety.com',
  MKETY_ACCESS_ISSUER: 'https://access.mkety.test',
  MKETY_ACCESS_AUDIENCE: 'mkety-trading',
  MKETY_ACCESS_JWKS_URL: 'https://access.mkety.test/.well-known/jwks.json',
};

test('invalid signed access is rejected before caller-selected workspace is read', async () => {
  let databaseRead = false;
  const supabase = {
    from() {
      databaseRead = true;
      throw new Error('workspace database must not be consulted before access verification');
    },
  };

  const result = await authorizeV1AdminRequest(new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      'X-Mkety-Workspace-Id': 'ws-guessed',
      Authorization: 'Bearer bad-token',
    },
  }), env, {
    supabase,
    authenticateFn: async (_request, options) => {
      assert.equal(options.requestedWorkspaceId, 'ws-guessed');
      return { ok: false, reason: 'INVALID_SIGNATURE' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'INVALID_SIGNATURE');
  assert.equal(databaseRead, false);
});

test('verified assertion workspace remains bound to exact persisted workspace and membership', async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(table);
      assert.equal(table, 'trading_workspace_access');
      const chain = {
        select() { return chain; },
        eq(column, value) {
          assert.equal(column, 'id');
          assert.equal(value, 'ws-1');
          return chain;
        },
        maybeSingle: async () => ({ data: { id: 'ws-1', trading_access_enabled: true }, error: null }),
      };
      return chain;
    },
  };

  const result = await authorizeV1AdminRequest(new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      'X-Mkety-Workspace-Id': 'ws-1',
      Authorization: 'Bearer signed-token',
    },
  }), env, {
    supabase,
    authenticateFn: async (_request, options) => {
      assert.equal(options.requestedWorkspaceId, 'ws-1');
      return { ok: true, subject: 'owner-1', workspaceId: 'ws-1', access: 'owner' };
    },
    membershipStoreFactory: () => ({
      async getMembership(workspaceId, subject) {
        assert.equal(workspaceId, 'ws-1');
        assert.equal(subject, 'owner-1');
        return { id: 'm-1', workspaceId: 'ws-1', subject: 'owner-1', role: 'owner', enabled: true };
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['trading_workspace_access']);
  assert.equal(result.workspace.id, 'ws-1');
  assert.equal(result.auth.subject, 'owner-1');
});
