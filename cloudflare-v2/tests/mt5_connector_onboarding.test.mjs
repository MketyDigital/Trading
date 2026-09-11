import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminMt5ConnectorRequest } from '../src/http/v1_admin_mt5_connector.js';
import { decryptConnectionCredentials, encryptConnectionCredentials } from '../src/security/connection_credentials.js';
import { verifyMt5ConnectionToken } from '../../ctrader-cbot-gateway/src/mt5_protocol.js';

const authorizeOwner = async () => ({
  ok: true,
  workspace: { id: 'ws-1' },
  membership: { role: 'owner' },
  auth: { subject: 'user-1' },
});

function createSupabase(capture, current = null) {
  return {
    from(table) {
      assert.equal(table, 'trade_accounts');
      return {
        insert(row) {
          capture.inserted = row;
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: { created_at: '2026-09-11T15:00:00.000Z', ...row }, error: null };
                },
              };
            },
          };
        },
        select() {
          return {
            eq() { return this; },
            async maybeSingle() { return { data: current, error: null }; },
          };
        },
        update(patch) {
          capture.updated = patch;
          return {
            eq() { return this; },
            select() {
              return {
                async maybeSingle() {
                  return { data: { ...current, ...patch }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

const env = {
  TRADING_MASTER_KEY: 'test-master-key-that-is-long-enough',
  CTRADER_CBOT_GATEWAY_URL: 'https://cbot.mkety.example:25345',
  CTRADER_CBOT_WS_URL: 'wss://cbot.mkety.example:25345/v1/cbot',
  CBOT_TOKEN_SIGNING_KEY: 'gateway-token-signing-key',
  CBOT_CONTROL_SECRET: 'gateway-control-secret',
};

test('MT5 connector onboarding returns short-lived one-time outbound pairing material and persists no customer env configuration', async () => {
  const capture = {};
  const startedAt = Date.now();
  const request = new Request('https://trade.mkety.com/api/v1/admin/connections/mt5/connector', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Main MT5', roles: ['execution'], environment: 'demo' }),
  });

  const response = await handleV1AdminMt5ConnectorRequest(request, env, {
    supabaseFactory: async () => createSupabase(capture),
    authorizeFn: authorizeOwner,
  });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.account.providerMode, 'mt5_connector');
  assert.equal(body.account.active, false);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.killSwitch, true);
  assert.equal(body.account.providerConfig.status, 'awaiting_connector');
  assert.equal(body.gatewayWebSocketUrl, 'wss://cbot.mkety.example:25345/v1/mt5');
  assert.match(body.oneTimeConnectionToken, /^mt5v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const expiresAt = Date.parse(body.connectionTokenExpiresAt);
  assert.ok(expiresAt >= startedAt + 14 * 60 * 1000);
  assert.ok(expiresAt <= Date.now() + 16 * 60 * 1000);

  assert.equal(capture.inserted.platform, 'mt5');
  assert.equal(capture.inserted.provider_mode, 'mt5_connector');
  assert.match(capture.inserted.account_id, /^pending:/);
  assert.equal(capture.inserted.server_name, null);
  assert.equal(capture.inserted.is_active, false);
  assert.equal(capture.inserted.execution_enabled, false);
  assert.deepEqual(capture.inserted.safety_policy, { killSwitch: true });

  const credentials = await decryptConnectionCredentials('mt5_connector', capture.inserted.credential_ciphertext, env.TRADING_MASTER_KEY);
  assert.equal(credentials.connectionToken, body.oneTimeConnectionToken);
  assert.equal(credentials.gatewayUrl, env.CTRADER_CBOT_GATEWAY_URL);
  assert.equal(credentials.controlSecret, env.CBOT_CONTROL_SECRET);

  const verified = verifyMt5ConnectionToken(body.oneTimeConnectionToken, env.CBOT_TOKEN_SIGNING_KEY, Date.now());
  assert.equal(verified.ok, true);
  assert.equal(verified.accountRowId, body.account.id);
  assert.equal(verified.purpose, 'pair');
});

test('MT5 connector sync persists actual terminal identity and sanitized account-wide symbols from authenticated gateway session', async () => {
  const capture = {};
  const credentialCiphertext = await encryptConnectionCredentials('mt5_connector', {
    connectionToken: 'mt5v1.test.test',
    gatewayUrl: env.CTRADER_CBOT_GATEWAY_URL,
    controlSecret: env.CBOT_CONTROL_SECRET,
  }, env.TRADING_MASTER_KEY);
  const current = {
    id: 'acct-mt5-1', workspace_id: 'ws-1', account_label: 'Main MT5', platform: 'mt5',
    account_id: 'pending:abc', server_name: null, lot_sizing_type: 'fixed', lot_value: 0.01,
    is_active: false, execution_enabled: false, safety_policy: { killSwitch: true },
    fast_entry_policy: {}, entry_zone_policy: {}, credential_ciphertext: credentialCiphertext,
    provider_mode: 'mt5_connector', environment: 'demo', roles: ['execution'],
    provider_config: { status: 'awaiting_connector' }, created_at: '2026-09-11T15:00:00.000Z',
  };
  const symbols = [
    { platformSymbol: 'XAUUSD.r', description: 'Gold', tradable: true, minVolume: 0.01, maxVolume: 100, stepVolume: 0.01, tickSize: 0.01, tickValue: 1, digits: 2 },
    { platformSymbol: 'Volatility 75 Index', description: 'Synthetic index', tradable: true, minVolume: 0.001, maxVolume: 100, stepVolume: 0.001, tickSize: 0.01, tickValue: 0.01, digits: 2 },
  ];

  const response = await handleV1AdminMt5ConnectorRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/mt5/connector/acct-mt5-1/sync', { method: 'POST' }),
    env,
    {
      supabaseFactory: async () => createSupabase(capture, current),
      authorizeFn: authorizeOwner,
      fetchFn: async (url, options) => {
        assert.match(url, /\/v1\/mt5-connections\/acct-mt5-1$/);
        assert.equal(options.headers.Authorization, `Bearer ${env.CBOT_CONTROL_SECRET}`);
        return new Response(JSON.stringify({
          ok: true, online: true, accountRowId: 'acct-mt5-1', connectedAt: Date.now(), lastHeartbeatAt: Date.now(),
          identity: {
            accountNumber: '50123456', serverName: 'Broker-Demo', brokerName: 'Broker Ltd', isLive: false,
            terminalName: 'MetaTrader 5', connectorInstanceId: 'pc-1', symbols,
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(capture.updated.account_id, '50123456');
  assert.equal(capture.updated.server_name, 'Broker-Demo');
  assert.equal(capture.updated.environment, 'demo');
  assert.equal(capture.updated.provider_config.status, 'connected');
  assert.equal(capture.updated.provider_config.brokerName, 'Broker Ltd');
  assert.equal(capture.updated.provider_config.symbolCatalog.length, 2);
  assert.equal(capture.updated.provider_config.symbolCatalog[0].platformSymbol, 'XAUUSD.r');
  assert.equal(capture.updated.provider_config.symbolCatalog[0].minLots, 0.01);
  assert.equal(capture.updated.provider_config.symbolCatalog[0].maxLots, 100);
  assert.equal(capture.updated.provider_config.symbolCatalog[0].stepLots, 0.01);
  assert.deepEqual(capture.updated.provider_config.symbolCatalog[0].aliases, []);
  assert.equal(capture.updated.provider_config.symbolCatalog[1].platformSymbol, 'Volatility 75 Index');
  assert.equal(body.account.accountId, '50123456');
});
