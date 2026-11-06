import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections_account_controls.js';

function makeFixture(role = 'owner') {
  const calls = [];
  const authorization = {
    ok: true,
    workspace: { id: 'ws-1' },
    auth: { subject: 'subject-1' },
    membership: { workspaceId: 'ws-1', subject: 'subject-1', role, enabled: true },
  };
  return {
    calls,
    dependencies: {
      authorizeFn: async () => authorization,
      persistenceRuntime: {
        workspaceAccess: {},
        accountFollowers: {
          async upsertLink(workspaceId, input) {
            calls.push(['upsertLink', workspaceId, input]);
            return { id: 'link-1', workspace_id: workspaceId, follower_account_id: 'follower-1', ...input };
          },
          async setEnabled(workspaceId, followerId, enabled) {
            calls.push(['setEnabled', workspaceId, followerId, enabled]);
            return { id: 'link-1', workspace_id: workspaceId, follower_account_id: followerId, enabled };
          },
        },
      },
    },
  };
}

function followerPut(body) {
  return new Request('https://trade.test/api/v1/admin/connections/accounts/follower-1/follower', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('workspace owner can configure independent follower risk policy', async () => {
  const fixture = makeFixture('owner');
  const response = await handleV1AdminConnectionsRequest(followerPut({
    enabled: true,
    parentAccountId: 'parent-1',
    riskMode: 'balance_percent',
    riskPercent: 1,
    riskBasis: 'balance',
  }), {}, fixture.dependencies);

  assert.equal(response.status, 200);
  const write = fixture.calls.find((call) => call[0] === 'upsertLink');
  assert.ok(write);
  assert.equal(write[1], 'ws-1');
  assert.equal(write[2].followerAccountId, 'follower-1');
  assert.equal(write[2].parentAccountId, 'parent-1');
  assert.equal(write[2].riskMode, 'balance_percent');
  assert.equal(write[2].riskPercent, 1);
  assert.equal(write[2].riskBasis, 'balance');
});

test('admin with accounts.write cannot change follower risk policy', async () => {
  const fixture = makeFixture('admin');
  const response = await handleV1AdminConnectionsRequest(followerPut({
    enabled: true,
    parentAccountId: 'parent-1',
    riskMode: 'equity_percent',
    riskPercent: 1,
    riskBasis: 'equity',
  }), {}, fixture.dependencies);

  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'RISK_POLICY_OWNER_REQUIRED');
  assert.equal(fixture.calls.length, 0);
});


test('partial follower update does not inject default risk settings into repository input', async () => {
  const fixture = makeFixture('owner');
  const response = await handleV1AdminConnectionsRequest(followerPut({
    enabled: true,
    parentAccountId: 'parent-1',
  }), {}, fixture.dependencies);

  assert.equal(response.status, 200);
  const write = fixture.calls.find((call) => call[0] === 'upsertLink');
  assert.ok(write);
  for (const key of ['lotMultiplier', 'lot_multiplier', 'fixedLot', 'fixed_lot', 'riskMode', 'risk_mode', 'riskPercent', 'risk_percent', 'riskAmount', 'risk_amount', 'riskBasis', 'risk_basis']) {
    assert.equal(Object.prototype.hasOwnProperty.call(write[2], key), false, key);
  }
});
