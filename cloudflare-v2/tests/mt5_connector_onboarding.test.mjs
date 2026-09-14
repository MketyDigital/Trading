import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminMt5ConnectorRequest } from '../src/http/v1_admin_mt5_connector.js';
import { decryptConnectionCredentials, encryptConnectionCredentials } from '../src/security/connection_credentials.js';
import { verifyMt5ConnectionToken } from '../../ctrader-cbot-gateway/src/mt5_protocol.js';

const WORKSPACE_EXPIRES_AT = '2027-09-08T23:00:00.000Z';
const ACCESS_CODE_ID = 'access-code-1';

const authorizeOwner = async () => ({
  ok: true,
  workspace: {
    id: 'ws-1',
    metadata: { accessCodeId: ACCESS_CODE_ID, accessCodeProvisioned: true },
  },
  membership: { role: 'owner' },
  auth: { subject: 'user-1' },
});

function createSupabase(capture, current = null, accessExpiresAt = WORKSPACE_EXPIRES_AT) {
  return {
    from(table) {
      if (table === 'trading_access_codes') {
        return {
          select() {
            return {
              eq() { return this; },
              async maybeSingle() {
                return { data: { id: ACCESS_CODE_ID, workspace_id: 'ws-1', expires_at: accessExpiresAt }, error: null };
              },
            };
          },
        };
      }
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

test('MT5 connector onboarding returns reusable outbound pairing material expiring with workspace access', async () => {
  const capture = {};
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
  assert.match(body.connectionToken, /^mt5v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(body.oneTimeConnectionToken, body.connectionToken);
  assert.equal(body.connectionTokenExpiresAt, WORKSPACE_EXPIRES_AT);

  assert.equal(capture.inserted.platform, 'mt5');
  assert.equal(capture.inserted.provider_mode, 'mt5_connector');
  assert.match(capture.inserted.account_id, /^pending:/);
  assert.equal(capture.inserted.server_name, null);
  assert.equal(capture.inserted.is_active, false);
  assert.equal(capture.inserted.execution_enabled, false);
  assert.deepEqual(capture.inserted.safety_policy, { killSwitch: true });

  const credentials = await decryptConnectionCredentials('mt5_connector', capture.inserted.credential_ciphertext, env.TRADING_MASTER_KEY);
  assert.equal(credentials.connectionToken, body.connectionToken);
  assert.equal(credentials.gatewayUrl, env.CTRADER_CBOT_GATEWAY_URL);
  assert.equal(credentials.controlSecret, env.CBOT_CONTROL_SECRET);

  const verified = verifyMt5ConnectionToken(body.connectionToken, env.CBOT_TOKEN_SIGNING_KEY, Date.parse('2026-09-14T09:00:00.000Z'));
  assert.equal(verified.ok, true);
  assert.equal(verified.accountRowId, body.account.id);
  assert.equal(verified.purpose, 'pair');
  assert.equal(verified.expiresAt, Date.parse(WORKSPACE_EXPIRES_AT));
});

test('existing MT5 destination can regenerate a reusable token without creating another destination', async () => {
  const capture = {};
  const credentialCiphertext = await encryptConnectionCredentials('mt5_connector', {
    gatewayUrl: env.CTRADER_CBOT_GATEWAY_URL,
    controlSecret: env.CBOT_CONTROL_SECRET,
  }, env.TRADING_MASTER_KEY);
  const current = {
    id: 'acct-mt5-1', workspace_id: 'ws-1', account_label: 'Main MT5', platform: 'mt5',
    account_id: '50123456', server_name: 'Broker-Demo', lot_sizing_type: 'fixed', lot_value: 0.01,
    is_active: true, execution_enabled: true, safety_policy: { killSwitch: false },
    fast_entry_policy: {}, entry_zone_policy: {}, credential_ciphertext: credentialCiphertext,
    provider_mode: 'mt5_connector', environment: 'demo', roles: ['execution'],
    provider_config: { status: 'connected' }, created_at: '2026-09-11T15:00:00.000Z',
  };

  const response = await handleV1AdminMt5ConnectorRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/mt5/connector/acct-mt5-1/token', { method: 'POST' }),
    env,
    { supabaseFactory: async () => createSupabase(capture, current), authorizeFn: authorizeOwner },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.accountId, 'acct-mt5-1');
  assert.match(body.connectionToken, /^mt5v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(body.connectionTokenExpiresAt, WORKSPACE_EXPIRES_AT);
  assert.equal(capture.updated.account_id, undefined);
  const credentials = await decryptConnectionCredentials('mt5_connector', capture.updated.credential_ciphertext, env.TRADING_MASTER_KEY);
  assert.equal(credentials.connectionToken, body.connectionToken);
  assert.equal(credentials.gatewayUrl, env.CTRADER_CBOT_GATEWAY_URL);
  assert.equal(credentials.controlSecret, env.CBOT_CONTROL_SECRET);
});

test('MT5 connector token generation is rejected after workspace access expiry', async () => {
  const capture = {};
  const credentialCiphertext = await encryptConnectionCredentials('mt5_connector', {
    gatewayUrl: env.CTRADER_CBOT_GATEWAY_URL,
    controlSecret: env.CBOT_CONTROL_SECRET,
  }, env.TRADING_MASTER_KEY);
  const current = {
    id: 'acct-mt5-1', workspace_id: 'ws-1', account_label: 'Main MT5', platform: 'mt5', account_id: '50123456',
    credential_ciphertext: credentialCiphertext,
    provider_mode: 'mt5_connector', environment: 'demo', roles: ['execution'], provider_config: {}, safety_policy: {},
  };
  const response = await handleV1AdminMt5ConnectorRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/mt5/connector/acct-mt5-1/token', { method: 'POST' }),
    env,
    {
      supabaseFactory: async () => createSupabase(capture, current, '2020-01-01T00:00:00.000Z'),
      authorizeFn: authorizeOwner,
    },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, reason: 'WORKSPACE_ACCESS_EXPIRED' });
});

test('MT5 connector sync persists terminal identity, retires local pairing storage and keeps only gateway control credentials', async () => {
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
  const persistedCredentials = await decryptConnectionCredentials('mt5_connector', capture.updated.credential_ciphertext, env.TRADING_MASTER_KEY);
  assert.equal(Object.hasOwn(persistedCredentials, 'connectionToken'), false);
  assert.equal(persistedCredentials.gatewayUrl, env.CTRADER_CBOT_GATEWAY_URL);
  assert.equal(persistedCredentials.controlSecret, env.CBOT_CONTROL_SECRET);
  assert.equal(body.account.accountId, '50123456');
});