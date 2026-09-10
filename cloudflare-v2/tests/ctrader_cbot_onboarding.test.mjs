import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminCTraderCbotRequest } from '../src/http/v1_admin_ctrader_cbot.js';
import { decryptConnectionCredentials } from '../src/security/connection_credentials.js';
import { verifyConnectionToken } from '../../ctrader-cbot-gateway/src/protocol.js';

function tradeAccountSupabase(capture) {
  return {
    from(table) {
      assert.equal(table, 'trade_accounts');
      return {
        insert(row) {
          capture.row = row;
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: { created_at: '2026-09-10T14:00:00.000Z', ...row }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const authorizeOwner = async () => ({
  ok: true,
  workspace: { id: 'ws-1' },
  membership: { role: 'owner' },
  auth: { subject: 'user-1' },
});

test('cTrader Cloud Auto Trader onboarding returns one-time setup material and persists safe encrypted credentials', async () => {
  const capture = {};
  const env = {
    TRADING_MASTER_KEY: 'test-master-key-that-is-long-enough',
    CTRADER_CBOT_GATEWAY_URL: 'https://cbot-control.mkety.example',
    CTRADER_CBOT_WS_URL: 'wss://cbot.mkety.example:25345/v1/cbot',
    CBOT_TOKEN_SIGNING_KEY: 'gateway-token-signing-key',
    CBOT_CONTROL_SECRET: 'gateway-control-secret',
  };
  const request = new Request('https://trade.mkety.com/api/v1/admin/connections/ctrader/cbot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Demo Cloud Auto Trader', roles: ['execution'], environment: 'demo' }),
  });

  const response = await handleV1AdminCTraderCbotRequest(request, env, {
    supabaseFactory: async () => tradeAccountSupabase(capture),
    authorizeFn: authorizeOwner,
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.account.providerMode, 'ctrader_cbot');
  assert.equal(body.account.active, false);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.killSwitch, true);
  assert.equal(body.account.providerConfig.status, 'awaiting_cbot');
  assert.equal(body.gatewayWebSocketUrl, env.CTRADER_CBOT_WS_URL);
  assert.match(body.oneTimeConnectionToken, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(typeof body.connectionTokenExpiresAt, 'string');

  assert.equal(capture.row.platform, 'ctrader');
  assert.equal(capture.row.provider_mode, 'ctrader_cbot');
  assert.match(capture.row.account_id, /^pending:/);
  assert.equal(capture.row.is_active, false);
  assert.equal(capture.row.execution_enabled, false);
  assert.deepEqual(capture.row.safety_policy, { killSwitch: true });

  const credentials = await decryptConnectionCredentials('ctrader_cbot', capture.row.credential_ciphertext, env.TRADING_MASTER_KEY);
  assert.equal(credentials.connectionToken, body.oneTimeConnectionToken);
  assert.equal(credentials.gatewayUrl, env.CTRADER_CBOT_GATEWAY_URL);
  assert.equal(credentials.controlSecret, env.CBOT_CONTROL_SECRET);

  const verified = verifyConnectionToken(body.oneTimeConnectionToken, env.CBOT_TOKEN_SIGNING_KEY, Date.now());
  assert.equal(verified.ok, true);
  assert.equal(verified.accountRowId, body.account.id);
});

test('cTrader Cloud Auto Trader onboarding fails closed when gateway configuration is incomplete', async () => {
  const request = new Request('https://trade.mkety.com/api/v1/admin/connections/ctrader/cbot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Demo Cloud Auto Trader' }),
  });
  const response = await handleV1AdminCTraderCbotRequest(request, {
    TRADING_MASTER_KEY: 'test-master-key-that-is-long-enough',
  }, {
    supabaseFactory: async () => tradeAccountSupabase({}),
    authorizeFn: authorizeOwner,
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, reason: 'CTRADER_CBOT_NOT_CONFIGURED' });
});
