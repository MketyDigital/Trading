import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminRequest } from '../src/http/v1_admin.js';
import { hasTradingPermission } from '../src/security/trading_permissions.js';

const workspace = {
  id: 'ws-1',
  display_name: 'Enterprise One',
  zitadel_org_id: 'org-1',
  trading_access_enabled: true,
  trading_required_role: 'trading_admin',
};

const zitadelEnv = {
  ZITADEL_ISSUER: 'https://login.example',
  ZITADEL_AUDIENCE: 'trading-api',
  ZITADEL_JWKS_URL: 'https://login.example/oauth/v2/keys',
  ZITADEL_PROJECT_ID: 'project-1',
  BROKER_EXECUTION_ENABLED: 'false',
};

function membershipStore(role = 'admin') {
  return () => ({
    async getMembership(workspaceId, subject) {
      assert.equal(workspaceId, 'ws-1');
      assert.equal(subject, 'u1');
      return { id: 'm1', workspaceId: 'ws-1', subject: 'u1', role, enabled: true };
    },
  });
}

function createSupabase(accounts = []) {
  const updates = [];
  return {
    updates,
    from(table) {
      if (table === 'trading_workspace_access') {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          maybeSingle: async () => ({ data: workspace, error: null }),
        };
        return chain;
      }
      if (table === 'trade_accounts') {
        let filtered = [...accounts];
        let pendingUpdate = null;
        const chain = {
          select() { return chain; },
          eq(column, value) {
            filtered = filtered.filter((row) => String(row[column]) === String(value));
            return chain;
          },
          order() { return Promise.resolve({ data: filtered, error: null }); },
          update(value) {
            pendingUpdate = value;
            return chain;
          },
          maybeSingle: async () => {
            if (!filtered[0]) return { data: null, error: null };
            const row = pendingUpdate ? { ...filtered[0], ...pendingUpdate } : filtered[0];
            if (pendingUpdate) updates.push({ id: filtered[0].id, workspaceId: filtered[0].workspace_id, value: pendingUpdate });
            return { data: row, error: null };
          },
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function request(path, { method = 'GET', role = 'admin', body, supabase } = {}) {
  return handleV1AdminRequest(new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: {
      'X-Mkety-Workspace-Id': 'ws-1',
      Authorization: 'Bearer token',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }), zitadelEnv, {
    supabaseFactory: async () => supabase,
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1' }),
    membershipStoreFactory: membershipStore(role),
  });
}

test('only owner/admin receive account control permissions and no role receives broker master-fuse permission', () => {
  for (const role of ['owner', 'admin']) {
    assert.equal(hasTradingPermission(role, 'accounts.read'), true);
    assert.equal(hasTradingPermission(role, 'accounts.write'), true);
  }
  for (const role of ['operator', 'viewer']) {
    assert.equal(hasTradingPermission(role, 'accounts.read'), false);
    assert.equal(hasTradingPermission(role, 'accounts.write'), false);
  }
  for (const role of ['owner', 'admin', 'operator', 'viewer']) {
    assert.equal(hasTradingPermission(role, 'broker.master.enable'), false);
  }
});

test('account list is exact-workspace and strips credential fields while exposing execution and kill-switch state', async () => {
  const supabase = createSupabase([
    {
      id: 'acc-1', workspace_id: 'ws-1', account_label: 'Demo MT5', platform: 'mt5', account_id: '1001',
      api_token_encrypted: 'cipher-secret', server_name: 'Broker-Demo', is_active: true,
      execution_enabled: false, safety_policy: { enabled: true, killSwitch: true, maxLotsPerTrade: 0.1 },
    },
    {
      id: 'acc-other', workspace_id: 'ws-2', account_label: 'Other', platform: 'ctrader', account_id: '2002',
      api_token_encrypted: 'other-secret', is_active: true, execution_enabled: true,
      safety_policy: { enabled: true, killSwitch: false },
    },
  ]);

  const response = await request('/api/v1/admin/accounts', { supabase });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.accounts.length, 1);
  assert.equal(body.accounts[0].id, 'acc-1');
  assert.equal(body.accounts[0].executionEnabled, false);
  assert.equal(body.accounts[0].killSwitch, true);
  assert.equal(body.accounts[0].api_token_encrypted, undefined);
  assert.equal(body.accounts[0].accountId, '1001');
});

test('admin can activate an onboarded account without enabling execution or changing the global broker fuse', async () => {
  const supabase = createSupabase([{
    id: 'acc-1', workspace_id: 'ws-1', account_label: 'Demo MT5', platform: 'mt5', account_id: '1001',
    credential_ciphertext: 'cipher-secret', is_active: false, execution_enabled: false,
    safety_policy: { enabled: true, killSwitch: true, maxLotsPerTrade: 0.1 },
  }]);

  const response = await request('/api/v1/admin/accounts/acc-1/active', {
    method: 'POST', body: { enabled: true, executionEnabled: true, BROKER_EXECUTION_ENABLED: true }, supabase,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.account.active, true);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.killSwitch, true);
  assert.equal(body.account.credentialConfigured, true);
  assert.equal(body.account.credential_ciphertext, undefined);
  assert.equal(body.masterBrokerExecutionEnabled, false);
  assert.deepEqual(supabase.updates, [{ id: 'acc-1', workspaceId: 'ws-1', value: { is_active: true } }]);
});

test('account activation control requires a boolean and remains exact-workspace scoped', async () => {
  const supabase = createSupabase([{
    id: 'acc-1', workspace_id: 'ws-1', account_label: 'Demo MT5', platform: 'mt5', account_id: '1001',
    credential_ciphertext: 'cipher-secret', is_active: false, execution_enabled: false,
    safety_policy: { enabled: true, killSwitch: true },
  }]);

  const invalid = await request('/api/v1/admin/accounts/acc-1/active', {
    method: 'POST', body: { enabled: 'true' }, supabase,
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).reason, 'ENABLED_BOOLEAN_REQUIRED');
  assert.equal(supabase.updates.length, 0);

  const missing = await request('/api/v1/admin/accounts/acc-other/active', {
    method: 'POST', body: { enabled: true }, supabase,
  });
  assert.equal(missing.status, 404);
  assert.equal(supabase.updates.length, 0);
});

test('admin can toggle only account execution_enabled inside authenticated workspace without changing global broker fuse', async () => {
  const supabase = createSupabase([{
    id: 'acc-1', workspace_id: 'ws-1', account_label: 'Demo MT5', platform: 'mt5', account_id: '1001',
    api_token_encrypted: 'cipher-secret', is_active: true, execution_enabled: false,
    safety_policy: { enabled: true, killSwitch: false, maxLotsPerTrade: 0.1 },
  }]);

  const response = await request('/api/v1/admin/accounts/acc-1/execution', {
    method: 'POST', body: { enabled: true, BROKER_EXECUTION_ENABLED: true }, supabase,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.account.executionEnabled, true);
  assert.equal(body.masterBrokerExecutionEnabled, false);
  assert.deepEqual(supabase.updates, [{ id: 'acc-1', workspaceId: 'ws-1', value: { execution_enabled: true } }]);
});

test('admin kill switch mutation preserves the rest of safety policy and operator cannot mutate account controls', async () => {
  const account = {
    id: 'acc-1', workspace_id: 'ws-1', account_label: 'Demo cTrader', platform: 'ctrader', account_id: '2001',
    api_token_encrypted: 'cipher-secret', is_active: true, execution_enabled: false,
    safety_policy: { enabled: true, killSwitch: false, maxLotsPerTrade: 0.2, allowedSymbols: ['XAUUSD'] },
  };
  const adminSupabase = createSupabase([account]);
  const adminResponse = await request('/api/v1/admin/accounts/acc-1/kill-switch', {
    method: 'POST', body: { enabled: true }, supabase: adminSupabase,
  });
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(adminSupabase.updates[0].value.safety_policy, {
    enabled: true, killSwitch: true, maxLotsPerTrade: 0.2, allowedSymbols: ['XAUUSD'],
  });

  const operatorSupabase = createSupabase([account]);
  const operatorResponse = await request('/api/v1/admin/accounts/acc-1/execution', {
    method: 'POST', role: 'operator', body: { enabled: true }, supabase: operatorSupabase,
  });
  assert.equal(operatorResponse.status, 403);
  assert.equal(operatorSupabase.updates.length, 0);
});
