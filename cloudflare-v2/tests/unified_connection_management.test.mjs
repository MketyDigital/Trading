import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCTraderAuthorizationUrl,
  connectionReadiness,
  normalizeCTraderDiscoveredAccounts,
  normalizeConnectionRoles,
  sanitizeConnectionConfig,
} from '../src/http/v1_admin_connections.js';
import { buildAccountsByAccessTokenMessage } from '../src/adapters/ctrader_protocol.js';
import { handleCTraderOAuthPublicCallback } from '../src/http/ctrader_oauth_callback.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('cTrader authorization uses Mkety application redirect and trading scope', () => {
  const url = new URL(buildCTraderAuthorizationUrl({
    clientId: 'mkety-client',
    redirectUri: 'https://trade.mkety.com/api/v1/integrations/ctrader/callback',
  }));
  assert.equal(url.origin, 'https://id.ctrader.com');
  assert.equal(url.pathname, '/my/settings/openapi/grantingaccess/');
  assert.equal(url.searchParams.get('client_id'), 'mkety-client');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://trade.mkety.com/api/v1/integrations/ctrader/callback');
  assert.equal(url.searchParams.get('scope'), 'trading');
  assert.equal(url.searchParams.get('product'), 'web');
});

test('cTrader readiness fails closed until every server-side credential is configured', () => {
  assert.equal(connectionReadiness({}).ctrader.configured, false);
  assert.equal(connectionReadiness({ CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 'secret', CTRADER_REDIRECT_URI: 'https://trade.mkety.com/cb' }).ctrader.configured, false);
  assert.equal(connectionReadiness({ CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 'secret', CTRADER_REDIRECT_URI: 'https://trade.mkety.com/cb', TRADING_MASTER_KEY: 'master' }).ctrader.configured, true);
});

test('cTrader account discovery message uses account-list-by-token payload', () => {
  assert.deepEqual(buildAccountsByAccessTokenMessage('token-value', 'msg-1'), {
    clientMsgId: 'msg-1',
    payloadType: 2149,
    payload: { accessToken: 'token-value' },
  });
});

test('discovered cTrader accounts normalize and deduplicate physical account IDs', () => {
  assert.deepEqual(normalizeCTraderDiscoveredAccounts([
    { ctidTraderAccountId: 101, isLive: false, traderLogin: 5001 },
    { ctidTraderAccountId: 101, isLive: false, traderLogin: 5001, brokerTitleShort: 'Demo Broker' },
    { ctidTraderAccountId: 202, isLive: true, traderLogin: 5002, brokerTitleShort: 'Live Broker' },
  ]), [
    { ctidTraderAccountId: '101', isLive: false, traderLogin: '5001', brokerTitleShort: 'Demo Broker' },
    { ctidTraderAccountId: '202', isLive: true, traderLogin: '5002', brokerTitleShort: 'Live Broker' },
  ]);
});

test('connection configuration strips nested secrets and roles allow one physical account to serve both jobs', () => {
  assert.deepEqual(sanitizeConnectionConfig({ allowed_chat_ids: ['1'], nested: { password: 'never', mode: 'safe' }, accessToken: 'never' }), {
    allowed_chat_ids: ['1'], nested: { mode: 'safe' },
  });
  assert.deepEqual(normalizeConnectionRoles(['source', 'execution', 'source']), ['source', 'execution']);
});

test('public cTrader callback redirects the short-lived code to the portal and never includes credentials', async () => {
  const response = handleCTraderOAuthPublicCallback(new Request('https://trade.mkety.com/api/v1/integrations/ctrader/callback?code=abc123'));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), '/?ctrader_code=abc123');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('unified account persistence is fail-closed for broker execution', () => {
  const source = fs.readFileSync(path.resolve(here, '../src/http/v1_admin_connections.js'), 'utf8');
  assert.match(source, /is_active:\s*false/g);
  assert.match(source, /execution_enabled:\s*false/g);
  assert.match(source, /killSwitch:\s*true/g);
  assert.doesNotMatch(source, /execution_enabled:\s*true/);
  assert.doesNotMatch(source, /is_active:\s*true/);
});
