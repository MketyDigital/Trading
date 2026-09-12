import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections.js';

function fakeSupabase(inserted) {
  return {
    from(table) {
      assert.equal(table, 'trading_ctrader_oauth_states');
      return {
        insert(row) {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

test('cTrader OAuth started from an active custom workspace host returns through the canonical relay', async () => {
  const inserted = [];
  const request = new Request('https://copier.starpipsforex.com/api/v1/admin/connections/ctrader/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mkety-Workspace-Id': 'workspace-1' },
    body: JSON.stringify({ roles: ['source', 'execution'] }),
  });
  const response = await handleV1AdminConnectionsRequest(request, {
    CTRADER_CLIENT_ID: 'client',
    CTRADER_CLIENT_SECRET: 'secret',
    CTRADER_REDIRECT_URI: 'https://trade.mkety.com/api/v1/integrations/ctrader/callback',
    TRADING_MASTER_KEY: 'master',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'session-secret',
    TRADING_CANONICAL_HOSTS: 'trade.mkety.com',
  }, {
    supabaseFactory: async () => fakeSupabase(inserted),
    authorizeFn: async () => ({
      ok: true,
      workspace: { id: 'workspace-1' },
      auth: { subject: 'owner-1' },
      membership: { role: 'owner' },
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].workspace_id, 'workspace-1');

  const authorizationUrl = new URL(body.authorizationUrl);
  assert.equal(authorizationUrl.origin, 'https://trade.mkety.com');
  assert.equal(authorizationUrl.pathname, '/api/v1/integrations/ctrader/authorize');
  assert.ok(authorizationUrl.searchParams.get('relay'));
});
