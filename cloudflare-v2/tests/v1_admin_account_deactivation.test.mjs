import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdminAccountStore, handleAuthorizedV1AdminAccountsRequest } from '../src/http/v1_admin_accounts.js';

const authorization = {
  workspace: { id: 'ws-1' },
  membership: { role: 'owner', enabled: true },
};

function supabaseFor(account) {
  let updatePayload = null;
  const calls = [];
  return {
    calls,
    get updatePayload() { return updatePayload; },
    from(table) {
      assert.equal(table, 'trade_accounts');
      calls.push(['from', table]);
      const chain = {
        update(value) { updatePayload = value; calls.push(['update', value]); return chain; },
        eq(column, value) { calls.push(['eq', column, value]); return chain; },
        select(columns) { calls.push(['select', columns]); return chain; },
        async maybeSingle() {
          return { data: { ...account, ...updatePayload }, error: null };
        },
      };
      return chain;
    },
  };
}

test('deactivating an account also clears stale execution eligibility so reactivation cannot resume trading by itself', async () => {
  const supabase = supabaseFor({
    id: 'acc-1',
    workspace_id: 'ws-1',
    account_label: 'Primary MT5',
    platform: 'mt5',
    account_id: '10001',
    is_active: true,
    execution_enabled: true,
    credential_ciphertext: 'synthetic-envelope',
    safety_policy: { enabled: true, killSwitch: false },
  });
  const accountStore = createAdminAccountStore(supabase);

  const response = await handleAuthorizedV1AdminAccountsRequest(new Request(
    'https://trade.test/api/v1/admin/accounts/acc-1/active',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    },
  ), authorization, {
    accountStore,
    env: { BROKER_EXECUTION_ENABLED: 'true' },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(supabase.updatePayload, {
    is_active: false,
    execution_enabled: false,
  });
  const body = await response.json();
  assert.equal(body.account.active, false);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.masterBrokerExecutionEnabled, true);
});
