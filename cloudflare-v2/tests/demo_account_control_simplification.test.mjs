import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections.js';

const authorization = {
  ok: true,
  workspace: { id: 'ws-1' },
  auth: { subject: 'owner-1' },
  membership: { role: 'owner' },
};

function accountRow(overrides = {}) {
  return {
    id: 'acc-1',
    workspace_id: 'ws-1',
    account_label: 'Deriv Demo',
    platform: 'ctrader',
    account_id: '20362650',
    server_name: null,
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    is_active: true,
    execution_enabled: false,
    live_execution_enabled: false,
    safety_policy: { killSwitch: true },
    fast_entry_policy: {},
    entry_zone_policy: {},
    credential_ciphertext: 'encrypted',
    provider_mode: 'ctrader_oauth',
    environment: 'demo',
    roles: ['execution'],
    provider_config: {},
    created_at: '2026-09-12T00:00:00Z',
    ...overrides,
  };
}

function fakeSupabase(initial) {
  let current = { ...initial };
  const updates = [];
  return {
    updates,
    from(table) {
      assert.equal(table, 'trade_accounts');
      let pendingUpdate = null;
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        update(payload) { pendingUpdate = payload; updates.push(payload); return chain; },
        async maybeSingle() {
          if (pendingUpdate) current = { ...current, ...pendingUpdate };
          return { data: current, error: null };
        },
      };
      return chain;
    },
  };
}

async function putAccount(initial, body) {
  const supabase = fakeSupabase(initial);
  const response = await handleV1AdminConnectionsRequest(
    new Request('https://trade.mkety.com/api/v1/admin/connections/accounts/acc-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {},
    {
      supabaseFactory: async () => supabase,
      authorizeFn: async () => authorization,
    },
  );
  return { response, supabase };
}

test('demo Trading ON atomically enables execution and clears the internal kill switch', async () => {
  const { response, supabase } = await putAccount(accountRow(), { tradingEnabled: true });
  assert.equal(response.status, 200);
  assert.deepEqual(supabase.updates.at(-1), {
    execution_enabled: true,
    live_execution_enabled: false,
    safety_policy: { killSwitch: false },
  });
  const body = await response.json();
  assert.equal(body.account.tradingEnabled, true);
  assert.equal(body.account.liveExecutionEnabled, false);
});

test('demo Trading OFF disables execution, restores kill switch, and keeps live permission off', async () => {
  const { response, supabase } = await putAccount(accountRow({
    execution_enabled: true,
    safety_policy: { killSwitch: false },
  }), { tradingEnabled: false });
  assert.equal(response.status, 200);
  assert.deepEqual(supabase.updates.at(-1), {
    execution_enabled: false,
    live_execution_enabled: false,
    safety_policy: { killSwitch: true },
  });
  const body = await response.json();
  assert.equal(body.account.tradingEnabled, false);
});

test('demo accounts reject a real-money permission toggle because it is not applicable', async () => {
  const { response, supabase } = await putAccount(accountRow(), { allowLiveExecution: true });
  assert.equal(response.status, 400);
  assert.equal(supabase.updates.length, 0);
  assert.deepEqual(await response.json(), { ok: false, reason: 'ACCOUNT_LIVE_EXECUTION_NOT_APPLICABLE' });
});

test('live account keeps real-money permission separate from its Trading ON/OFF control', async () => {
  const live = accountRow({ environment: 'live', account_label: 'Deriv Live' });
  const first = await putAccount(live, { tradingEnabled: true });
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.supabase.updates.at(-1), {
    execution_enabled: true,
    safety_policy: { killSwitch: false },
  });

  const second = await putAccount(live, { allowLiveExecution: true });
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.supabase.updates.at(-1), { live_execution_enabled: true });
  const body = await second.response.json();
  assert.equal(body.account.liveExecutionEnabled, true);
});

test('connections UI exposes one Trading toggle for demo and a separate real-money toggle only for live accounts', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ui = fs.readFileSync(path.resolve(here, '../src/dashboard_unified_connections.js'), 'utf8');
  assert.match(ui, /data-account-trading/);
  assert.match(ui, /Trading ON/);
  assert.match(ui, /Trading OFF/);
  assert.match(ui, /data-account-live/);
  assert.match(ui, /Allow real-money/);
  assert.match(ui, /x\.environment==='live'/);
  assert.doesNotMatch(ui, /Execution flag ON/);
  assert.doesNotMatch(ui, /Kill switch ON/);
});
