import test from 'node:test';
import assert from 'node:assert/strict';
import { handleExternalMt5BridgeRequest } from '../src/http/external_mt5_bridge_endpoint.js';

function fakeSupabase(account, capture = {}) {
  return {
    from(table) {
      assert.equal(table, 'trade_accounts');
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: account, error: null }) };
            },
          };
        },
        update(value) {
          capture.update = value;
          return {
            eq() {
              return {
                select() {
                  return {
                    maybeSingle: async () => ({
                      data: {
                        ...account,
                        ...value,
                        environment: value.environment,
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function pairingRequest(body, secret = 'pairing-secret') {
  return new Request('https://trade.mkety.com/api/v1/external/mt5/bridge/row-1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Bridge-Secret': secret,
    },
    body: JSON.stringify(body),
  });
}

function existingAccount() {
  return {
    id: 'row-1',
    workspace_id: 'workspace-1',
    platform: 'mt5',
    provider_mode: 'mt5_bridge',
    account_id: 'pending:abc',
    server_name: null,
    credential_ciphertext: 'encrypted-bootstrap',
    provider_config: { status: 'awaiting_terminal', requiresRunningTerminal: true },
    is_active: false,
    execution_enabled: false,
    safety_policy: { killSwitch: true },
  };
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() };
}

test('MT5 pairing verifies and persists the terminal public HTTPS bridge URL', async () => {
  const capture = {};
  const encrypted = [];
  const fetches = [];
  const response = await handleExternalMt5BridgeRequest(
    pairingRequest({
      accountId: '12345678',
      serverName: 'Broker-Demo',
      environment: 'demo',
      bridgeUrl: 'https://mt5-abc.bridge.mkety.com/',
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      supabaseFactory: async () => fakeSupabase(existingAccount(), capture),
      decryptCredentials: async () => ({
        bridgeUrl: 'https://trade.mkety.com/api/v1/external/mt5/bridge',
        bridgeSecret: 'pairing-secret',
      }),
      encryptCredentials: async (kind, value) => {
        encrypted.push({ kind, value });
        return 'encrypted-runtime';
      },
      fetchImpl: async (url, options) => {
        fetches.push({ url, options });
        if (url.endsWith('/v1/health')) return Response.json({ ok: true });
        if (url.endsWith('/v1/account')) {
          return Response.json({ ok: true, account_id: '12345678', server_name: 'Broker-Demo' });
        }
        throw new Error(`unexpected fetch ${url}`);
      },
      now: () => new Date('2026-09-10T12:00:00.000Z'),
    },
  );

  const result = await responseJson(response);
  assert.equal(result.status, 200);
  assert.equal(result.body.paired, true);
  assert.equal(fetches.length, 2);
  assert.equal(fetches[0].url, 'https://mt5-abc.bridge.mkety.com/v1/health');
  assert.equal(fetches[1].url, 'https://mt5-abc.bridge.mkety.com/v1/account');
  assert.match(fetches[0].options.headers['X-Mkety-Signature'], /^v1=[a-f0-9]{64}$/);
  assert.equal(encrypted.length, 1);
  assert.deepEqual(encrypted[0], {
    kind: 'mt5',
    value: {
      bridgeUrl: 'https://mt5-abc.bridge.mkety.com',
      bridgeSecret: 'pairing-secret',
    },
  });
  assert.equal(capture.update.credential_ciphertext, 'encrypted-runtime');
  assert.equal(capture.update.account_id, '12345678');
  assert.equal(capture.update.provider_config.status, 'connected');
  assert.equal(existingAccount().is_active, false);
});

for (const [label, bridgeUrl] of [
  ['missing', undefined],
  ['non-HTTPS', 'http://127.0.0.1:8789'],
  ['credentials in URL', 'https://user:pass@bridge.example'],
  ['query string', 'https://bridge.example/?token=secret'],
  ['malformed', 'not-a-url'],
]) {
  test(`MT5 pairing rejects ${label} runtime bridge URL`, async () => {
    const body = { accountId: '12345678', serverName: 'Broker-Demo', environment: 'demo' };
    if (bridgeUrl !== undefined) body.bridgeUrl = bridgeUrl;
    const response = await handleExternalMt5BridgeRequest(
      pairingRequest(body),
      { TRADING_MASTER_KEY: 'master' },
      {
        supabaseFactory: async () => fakeSupabase(existingAccount()),
        decryptCredentials: async () => ({ bridgeUrl: 'https://bootstrap.example', bridgeSecret: 'pairing-secret' }),
        encryptCredentials: async () => 'should-not-run',
        fetchImpl: async () => { throw new Error('should-not-run'); },
      },
    );
    const result = await responseJson(response);
    assert.equal(result.status, 400);
    assert.equal(result.body.reason, 'MT5_BRIDGE_URL_INVALID');
  });
}

test('MT5 pairing fails closed when bridge account identity does not match submitted terminal account', async () => {
  const capture = {};
  const response = await handleExternalMt5BridgeRequest(
    pairingRequest({
      accountId: '12345678',
      serverName: 'Broker-Demo',
      environment: 'demo',
      bridgeUrl: 'https://mt5-abc.bridge.mkety.com',
    }),
    { TRADING_MASTER_KEY: 'master' },
    {
      supabaseFactory: async () => fakeSupabase(existingAccount(), capture),
      decryptCredentials: async () => ({ bridgeUrl: 'https://bootstrap.example', bridgeSecret: 'pairing-secret' }),
      encryptCredentials: async () => 'encrypted-runtime',
      fetchImpl: async (url) => {
        if (url.endsWith('/v1/health')) return Response.json({ ok: true });
        return Response.json({ ok: true, account_id: '99999999', server_name: 'Broker-Demo' });
      },
    },
  );
  const result = await responseJson(response);
  assert.equal(result.status, 409);
  assert.equal(result.body.reason, 'MT5_BRIDGE_ACCOUNT_MISMATCH');
  assert.equal(capture.update, undefined);
});
