import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections_relay.js';
import {
  handleCTraderOAuthRelayAuthorize,
  signCTraderRelay,
  verifyCTraderRelay,
} from '../src/http/ctrader_oauth_relay.js';
import { handleCTraderOAuthPublicCallback } from '../src/http/ctrader_oauth_callback.js';

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

const env = {
  CTRADER_CLIENT_ID: 'client',
  CTRADER_CLIENT_SECRET: 'secret',
  CTRADER_REDIRECT_URI: 'https://trade.mkety.com/api/v1/integrations/ctrader/callback',
  TRADING_MASTER_KEY: 'master',
  TRADING_ACCESS_CODE_SESSION_SECRET: 'session-secret',
  TRADING_CANONICAL_HOSTS: 'trade.mkety.com',
};

async function startFromCustomHost(inserted = []) {
  const request = new Request('https://copier.starpipsforex.com/api/v1/admin/connections/ctrader/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Mkety-Workspace-Id': 'workspace-1' },
    body: JSON.stringify({ roles: ['source', 'execution'], returnOrigin: 'https://evil.example' }),
  });
  const response = await handleV1AdminConnectionsRequest(request, env, {
    supabaseFactory: async () => fakeSupabase(inserted),
    authorizeFn: async () => ({
      ok: true,
      workspace: { id: 'workspace-1' },
      auth: { subject: 'owner-1' },
      membership: { role: 'owner' },
    }),
  });
  return { request, response };
}

test('cTrader OAuth started from an active custom workspace host returns through the canonical relay', async () => {
  const inserted = [];
  const { response } = await startFromCustomHost(inserted);

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

test('canonical relay sets a secure short-lived cookie and forwards only to official cTrader OAuth', async () => {
  const { response } = await startFromCustomHost();
  const body = await response.json();
  const relayResponse = await handleCTraderOAuthRelayAuthorize(new Request(body.authorizationUrl), env);

  assert.equal(relayResponse.status, 302);
  const cTraderUrl = new URL(relayResponse.headers.get('Location'));
  assert.equal(cTraderUrl.origin, 'https://id.ctrader.com');
  assert.equal(cTraderUrl.pathname, '/my/settings/openapi/grantingaccess/');
  assert.equal(cTraderUrl.searchParams.get('redirect_uri'), env.CTRADER_REDIRECT_URI);
  const cookie = relayResponse.headers.get('Set-Cookie');
  assert.match(cookie, /^mkety_ctrader_relay=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('cTrader callback returns to the exact initiating custom workspace origin', async () => {
  const { response } = await startFromCustomHost();
  const body = await response.json();
  const relayResponse = await handleCTraderOAuthRelayAuthorize(new Request(body.authorizationUrl), env);
  const cookie = relayResponse.headers.get('Set-Cookie').split(';')[0];

  const callback = await handleCTraderOAuthPublicCallback(new Request(
    'https://trade.mkety.com/api/v1/integrations/ctrader/callback?code=abc123',
    { headers: { Cookie: cookie } },
  ), env);

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('Location'), 'https://copier.starpipsforex.com/?ctrader_code=abc123');
  assert.match(callback.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('relay return origin is server-derived and a caller cannot inject an arbitrary redirect', async () => {
  const { response } = await startFromCustomHost();
  const body = await response.json();
  const relay = new URL(body.authorizationUrl).searchParams.get('relay');
  const payload = await verifyCTraderRelay(relay, env.TRADING_ACCESS_CODE_SESSION_SECRET);
  assert.equal(payload.returnOrigin, 'https://copier.starpipsforex.com');
  assert.notEqual(payload.returnOrigin, 'https://evil.example');
});

test('tampered and expired relay tokens fail closed', async () => {
  const token = await signCTraderRelay({
    state: 'state-1',
    returnOrigin: 'https://copier.starpipsforex.com',
    secret: env.TRADING_ACCESS_CODE_SESSION_SECRET,
    nowMs: 1_000,
    ttlSeconds: 60,
  });
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(await verifyCTraderRelay(tampered, env.TRADING_ACCESS_CODE_SESSION_SECRET, 2_000), null);
  assert.equal(await verifyCTraderRelay(token, env.TRADING_ACCESS_CODE_SESSION_SECRET, 62_000), null);
});
