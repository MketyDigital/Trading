import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminCTraderCbotRequest } from '../src/http/v1_admin_ctrader_cbot.js';
import { encryptConnectionCredentials } from '../src/security/connection_credentials.js';

const authorizeOwner = async () => ({
  ok: true,
  workspace: { id: 'ws-1' },
  membership: { role: 'owner' },
  auth: { subject: 'user-1' },
});

function syncSupabase(row, capture) {
  return {
    from(table) {
      assert.equal(table, 'trade_accounts');
      return {
        select() {
          return {
            eq() { return this; },
            async maybeSingle() { return { data: row, error: null }; },
          };
        },
        update(patch) {
          capture.patch = patch;
          return {
            eq() { return this; },
            select() { return this; },
            async maybeSingle() { return { data: { ...row, ...patch }, error: null }; },
          };
        },
      };
    },
  };
}

async function connectedRow(masterKey) {
  return {
    id: 'acct-cbot-1',
    workspace_id: 'ws-1',
    account_label: 'Cloud Auto Trader',
    platform: 'ctrader',
    provider_mode: 'ctrader_cbot',
    account_id: 'pending:abc',
    environment: null,
    server_name: null,
    credential_ciphertext: await encryptConnectionCredentials('ctrader_cbot', {
      connectionToken: 'v1.placeholder.signature',
      gatewayUrl: 'https://cbot-control.mkety.example',
      controlSecret: 'gateway-control-secret',
    }, masterKey),
    is_active: false,
    execution_enabled: false,
    safety_policy: { killSwitch: true },
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    roles: ['execution'],
    provider_config: { status: 'awaiting_cbot' },
  };
}

test('cBot sync persists authenticated gateway account identity without enabling execution', async () => {
  const masterKey = 'test-master-key-that-is-long-enough';
  const row = await connectedRow(masterKey);
  const capture = {};
  const fetchFn = async (url, options) => {
    assert.equal(url, 'https://cbot-control.mkety.example/v1/connections/acct-cbot-1');
    assert.equal(options.headers.Authorization, 'Bearer gateway-control-secret');
    return new Response(JSON.stringify({
      ok: true,
      online: true,
      accountRowId: 'acct-cbot-1',
      identity: {
        accountNumber: '987654',
        brokerName: 'Example Broker',
        isLive: false,
        instanceId: 'cloud-instance-1',
      },
      connectedAt: 1_000,
      lastHeartbeatAt: 2_000,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const response = await handleV1AdminCTraderCbotRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/ctrader/cbot/acct-cbot-1/sync', { method: 'POST' }),
    { TRADING_MASTER_KEY: masterKey },
    {
      supabaseFactory: async () => syncSupabase(row, capture),
      authorizeFn: authorizeOwner,
      fetchFn,
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.account.accountId, '987654');
  assert.equal(body.account.environment, 'demo');
  assert.equal(body.account.providerConfig.status, 'connected');
  assert.equal(body.account.active, false);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.killSwitch, true);
  assert.equal(capture.patch.account_id, '987654');
  assert.equal(capture.patch.environment, 'demo');
  assert.equal(capture.patch.is_active, undefined);
  assert.equal(capture.patch.execution_enabled, undefined);
  assert.equal(capture.patch.safety_policy, undefined);
});

test('cBot sync rejects gateway account-row identity mismatch', async () => {
  const masterKey = 'test-master-key-that-is-long-enough';
  const row = await connectedRow(masterKey);
  const capture = {};
  const response = await handleV1AdminCTraderCbotRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/ctrader/cbot/acct-cbot-1/sync', { method: 'POST' }),
    { TRADING_MASTER_KEY: masterKey },
    {
      supabaseFactory: async () => syncSupabase(row, capture),
      authorizeFn: authorizeOwner,
      fetchFn: async () => new Response(JSON.stringify({
        ok: true,
        online: true,
        accountRowId: 'different-account-row',
        identity: { accountNumber: '987654', isLive: false },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, reason: 'CTRADER_CBOT_IDENTITY_MISMATCH' });
  assert.equal(capture.patch, undefined);
});
