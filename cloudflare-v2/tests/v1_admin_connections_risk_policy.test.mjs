import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminConnectionsRequest } from '../src/http/v1_admin_connections.js';

function authorization(role = 'owner') {
  return {
    ok: true,
    workspace: { id: 'ws-1' },
    auth: { subject: 'subject-1' },
    membership: { workspaceId: 'ws-1', subject: 'subject-1', role, enabled: true },
  };
}

function makeRuntime(role = 'owner') {
  const calls = [];
  const row = {
    id: 'acct-1',
    workspace_id: 'ws-1',
    account_label: 'Primary MT5',
    platform: 'mt5',
    account_id: '10001',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    lot_sizing_config: {},
    safety_policy: { enabled: true, killSwitch: true, maxLotsPerTrade: 0.2 },
    is_active: false,
    execution_enabled: false,
  };
  return {
    calls,
    row,
    runtime: {
      accounts: {
        async getAccount(workspaceId, accountId) {
          calls.push(['getAccount', workspaceId, accountId]);
          return workspaceId === row.workspace_id && accountId === row.id ? { ...row } : null;
        },
        async updateAccount(workspaceId, accountId, update) {
          calls.push(['updateAccount', workspaceId, accountId, update]);
          if (workspaceId !== row.workspace_id || accountId !== row.id) return null;
          Object.assign(row, update);
          return { ...row };
        },
      },
    },
    authorizeFn: async () => authorization(role),
  };
}

function put(body) {
  return new Request('https://trade.test/api/v1/admin/connections/accounts/acct-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('owner can configure balance-percent risk on exactly the selected account using the compatible stored type', async () => {
  const fixture = makeRuntime('owner');
  const response = await handleV1AdminConnectionsRequest(put({
    lotSizingType: 'balance_risk_percent',
    lotValue: 1.5,
    riskPolicy: { maxRiskPercent: 2, maxOpenRiskPercent: 4, maxDailyLossPercent: 5 },
  }), {}, {
    persistenceRuntime: fixture.runtime,
    authorizeFn: fixture.authorizeFn,
  });

  assert.equal(response.status, 200);
  assert.equal(fixture.row.lot_sizing_type, 'risk_percent');
  assert.equal(fixture.row.lot_value, 1.5);
  assert.deepEqual(fixture.row.lot_sizing_config, { riskBasis: 'balance', riskMode: 'percent' });
  assert.equal(fixture.row.safety_policy.maxRiskPercent, 2);
  assert.equal(fixture.row.safety_policy.maxOpenRiskPercent, 4);
  assert.equal(fixture.row.safety_policy.maxDailyLossPercent, 5);
  assert.equal(fixture.row.safety_policy.killSwitch, true);
  assert.equal(fixture.calls.filter((call) => call[0] === 'updateAccount').length, 1);
});

test('admin with accounts.write cannot mutate account risk policy', async () => {
  const fixture = makeRuntime('admin');
  const response = await handleV1AdminConnectionsRequest(put({
    lotSizingType: 'equity_risk_percent',
    lotValue: 1,
  }), {}, {
    persistenceRuntime: fixture.runtime,
    authorizeFn: fixture.authorizeFn,
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'RISK_POLICY_OWNER_REQUIRED');
  assert.equal(fixture.calls.some((call) => call[0] === 'updateAccount'), false);
  assert.equal(fixture.row.lot_sizing_type, 'fixed');
});

test('owner can configure fixed-cash risk without treating cash as a percentage', async () => {
  const fixture = makeRuntime('owner');
  const response = await handleV1AdminConnectionsRequest(put({
    lotSizingType: 'fixed_risk',
    lotValue: 125,
    lotSizingConfig: { riskBasis: 'balance' },
  }), {}, {
    persistenceRuntime: fixture.runtime,
    authorizeFn: fixture.authorizeFn,
  });

  assert.equal(response.status, 200);
  assert.equal(fixture.row.lot_sizing_type, 'risk_percent');
  assert.equal(fixture.row.lot_value, 125);
  assert.deepEqual(fixture.row.lot_sizing_config, { riskBasis: 'balance', riskMode: 'fixed_cash' });
});

test('risk policy validation rejects an excessive percentage without persisting any part of the update', async () => {
  const fixture = makeRuntime('owner');
  const response = await handleV1AdminConnectionsRequest(put({
    lotSizingType: 'risk_percent',
    lotValue: 101,
    riskPolicy: { maxRiskPercent: 2 },
  }), {}, {
    persistenceRuntime: fixture.runtime,
    authorizeFn: fixture.authorizeFn,
  });

  assert.equal(response.status, 400);
  assert.equal(fixture.calls.some((call) => call[0] === 'updateAccount'), false);
  assert.equal(fixture.row.lot_sizing_type, 'fixed');
  assert.equal(fixture.row.safety_policy.maxRiskPercent, undefined);
});

test('account risk mutation is workspace-scoped and cannot update a foreign account', async () => {
  const fixture = makeRuntime('owner');
  const response = await handleV1AdminConnectionsRequest(new Request('https://trade.test/api/v1/admin/connections/accounts/acct-other', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lotSizingType: 'risk_percent', lotValue: 1 }),
  }), {}, {
    persistenceRuntime: fixture.runtime,
    authorizeFn: fixture.authorizeFn,
  });

  assert.equal(response.status, 404);
  assert.equal(fixture.calls.some((call) => call[0] === 'updateAccount'), false);
});

