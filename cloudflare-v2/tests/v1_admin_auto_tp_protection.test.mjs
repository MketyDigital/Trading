import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthorizedV1AdminAccountsRequest } from '../src/http/v1_admin_accounts.js';

const authorization = {
  workspace: { id: 'ws-1' },
  membership: { role: 'admin' },
};

const env = { BROKER_EXECUTION_ENABLED: 'false' };

function request(path, body) {
  return new Request(`https://trade.mkety.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('per-account automatic TP protection can be enabled without changing execution authority', async () => {
  let call;
  const response = await handleAuthorizedV1AdminAccountsRequest(
    request('/api/v1/admin/accounts/acc-1/auto-tp-protection', { enabled: true }),
    authorization,
    {
      env,
      accountStore: {
        async setAutoTpProtection(workspaceId, accountId, enabled) {
          call = { workspaceId, accountId, enabled };
          return {
            id: accountId,
            workspace_id: workspaceId,
            account_label: 'Demo',
            platform: 'mt5',
            is_active: true,
            execution_enabled: false,
            safety_policy: { enabled: true, killSwitch: true, autoTpProtection: enabled },
          };
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(call, { workspaceId: 'ws-1', accountId: 'acc-1', enabled: true });
  const body = await response.json();
  assert.equal(body.account.autoTpProtection, true);
  assert.equal(body.account.executionEnabled, false);
  assert.equal(body.account.killSwitch, true);
  assert.equal(body.masterBrokerExecutionEnabled, false);
});

test('automatic TP protection control is boolean-only and fails closed', async () => {
  let called = false;
  const response = await handleAuthorizedV1AdminAccountsRequest(
    request('/api/v1/admin/accounts/acc-1/auto-tp-protection', { enabled: 'yes' }),
    authorization,
    {
      env,
      accountStore: {
        async setAutoTpProtection() { called = true; return null; },
      },
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, reason: 'ENABLED_BOOLEAN_REQUIRED' });
  assert.equal(called, false);
});
