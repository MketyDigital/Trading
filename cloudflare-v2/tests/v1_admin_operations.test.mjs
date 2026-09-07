import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminRequest } from '../src/http/v1_admin.js';
import { createAdminOperationsStore } from '../src/http/v1_admin_operations.js';
import { hasTradingPermission } from '../src/security/trading_permissions.js';

const workspace = {
  id: 'ws-1',
  display_name: 'Enterprise One',
  zitadel_org_id: 'org-1',
  trading_access_enabled: true,
  trading_required_role: 'trading_admin',
};

const env = {
  ZITADEL_ISSUER: 'https://login.example',
  ZITADEL_AUDIENCE: 'trading-api',
  ZITADEL_JWKS_URL: 'https://login.example/oauth/v2/keys',
  ZITADEL_PROJECT_ID: 'project-1',
  BROKER_EXECUTION_ENABLED: 'false',
};

function membershipStore(role = 'admin') {
  return () => ({
    async getMembership(workspaceId, subject) {
      return { id: 'm1', workspaceId, subject, role, enabled: true };
    },
  });
}

function authSupabase() {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle: async () => ({ data: workspace, error: null }),
      };
      return chain;
    },
  };
}

async function adminRequest(path, { method = 'GET', role = 'admin', operationsStore } = {}) {
  return handleV1AdminRequest(new Request(`https://trade.mkety.com${path}`, {
    method,
    headers: {
      'X-Mkety-Workspace-Id': 'ws-1',
      Authorization: 'Bearer token',
    },
  }), env, {
    supabaseFactory: async () => authSupabase(),
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1' }),
    membershipStoreFactory: membershipStore(role),
    operationsStoreFactory: () => operationsStore,
  });
}

function querySupabase({ deliveries = [], accounts = [] } = {}) {
  const queries = [];
  const rowsFor = (table) => table === 'destination_deliveries' ? deliveries : table === 'trade_accounts' ? accounts : [];

  return {
    queries,
    from(table) {
      const state = { table, filters: [], inFilters: [], lteFilters: [], selected: '*', options: {}, limit: null, order: null };
      queries.push(state);
      const chain = {
        select(columns, options = {}) { state.selected = columns; state.options = options || {}; return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        in(column, values) { state.inFilters.push([column, values]); return chain; },
        lte(column, value) { state.lteFilters.push([column, value]); return chain; },
        order(column, options = {}) { state.order = [column, options]; return chain; },
        limit(value) { state.limit = value; return chain; },
        then(resolve, reject) {
          try {
            let rows = [...rowsFor(table)];
            for (const [column, value] of state.filters) rows = rows.filter((row) => String(row[column]) === String(value));
            for (const [column, values] of state.inFilters) rows = rows.filter((row) => values.map(String).includes(String(row[column])));
            for (const [column, value] of state.lteFilters) rows = rows.filter((row) => row[column] != null && new Date(row[column]).getTime() <= new Date(value).getTime());
            if (state.order) {
              const [column, options] = state.order;
              rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (options.ascending === false ? -1 : 1));
            }
            if (Number.isInteger(state.limit)) rows = rows.slice(0, state.limit);
            const result = state.options?.head === true
              ? { data: null, count: rows.length, error: null }
              : { data: rows, count: state.options?.count ? rows.length : null, error: null };
            return Promise.resolve(result).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return chain;
    },
  };
}

test('operations.read is owner/admin only and never implies broker master enablement', () => {
  for (const role of ['owner', 'admin']) assert.equal(hasTradingPermission(role, 'operations.read'), true);
  for (const role of ['operator', 'viewer']) assert.equal(hasTradingPermission(role, 'operations.read'), false);
  for (const role of ['owner', 'admin', 'operator', 'viewer']) {
    assert.equal(hasTradingPermission(role, 'broker.master.enable'), false);
  }
});

test('admin operations route is read-only, exact-workspace authorized, and fails closed on store errors', async () => {
  const snapshot = { workspaceId: 'ws-1', observedAt: '2026-09-03T10:00:00.000Z', deliveries: { counts: {} }, accountSafety: { blocked: [] } };
  const ok = await adminRequest('/api/v1/admin/operations', { operationsStore: { snapshot: async (workspaceId) => ({ ...snapshot, workspaceId }) } });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).operations, snapshot);

  const denied = await adminRequest('/api/v1/admin/operations', { role: 'operator', operationsStore: { snapshot: async () => snapshot } });
  assert.equal(denied.status, 403);

  const method = await adminRequest('/api/v1/admin/operations', { method: 'POST', operationsStore: { snapshot: async () => snapshot } });
  assert.equal(method.status, 405);

  const failed = await adminRequest('/api/v1/admin/operations', { operationsStore: { snapshot: async () => { throw new Error('db detail must not leak'); } } });
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { ok: false, reason: 'OPERATIONS_QUERY_FAILED' });
});

test('operations store reports exact durable delivery state, overdue retries, sanitized recent failures, and current account safety blocks', async () => {
  const now = '2026-09-03T10:00:00.000Z';
  const supabase = querySupabase({
    deliveries: [
      { id: 'd-pending', workspace_id: 'ws-1', status: 'PENDING', updated_at: '2026-09-03T09:00:00Z' },
      { id: 'd-success', workspace_id: 'ws-1', status: 'SUCCEEDED', updated_at: '2026-09-03T09:01:00Z' },
      { id: 'd-retry-due', workspace_id: 'ws-1', trading_event_id: 'evt-1', destination_type: 'mt5', destination_ref: 'trade-account:acc-1', idempotency_key: 'secret-ish-key', status: 'RETRYABLE', error_code: 'MT5_TEMPORARY', failure_class: 'RETRYABLE', attempt_count: 2, next_attempt_at: '2026-09-03T09:59:00Z', request_payload: { credential: 'never' }, response_payload: { raw: 'never' }, updated_at: '2026-09-03T09:59:30Z' },
      { id: 'd-retry-future', workspace_id: 'ws-1', status: 'RETRYABLE', next_attempt_at: '2026-09-03T10:01:00Z', updated_at: '2026-09-03T09:58:00Z' },
      { id: 'd-uncertain', workspace_id: 'ws-1', trading_event_id: 'evt-2', destination_type: 'ctrader', destination_ref: 'trade-account:acc-2', status: 'UNCERTAIN', error_code: 'BROKER_STATE_UNKNOWN', failure_class: 'UNCERTAIN', attempt_count: 1, response_payload: { token: 'never' }, updated_at: '2026-09-03T09:57:00Z' },
      { id: 'd-failed', workspace_id: 'ws-1', trading_event_id: 'evt-3', destination_type: 'mt5', destination_ref: 'trade-account:acc-3', status: 'FAILED', error_code: 'ORDER_REJECTED', failure_class: 'TERMINAL', attempt_count: 1, request_payload: { password: 'never' }, updated_at: '2026-09-03T09:56:00Z' },
      { id: 'd-other', workspace_id: 'ws-2', status: 'FAILED', error_code: 'OTHER_TENANT', updated_at: '2026-09-03T09:59:59Z' },
    ],
    accounts: [
      { id: 'acc-1', workspace_id: 'ws-1', account_label: 'MT5 Demo', platform: 'mt5', account_id: '100001', api_token_encrypted: 'cipher', is_active: true, execution_enabled: false, safety_policy: { enabled: true, killSwitch: false } },
      { id: 'acc-2', workspace_id: 'ws-1', account_label: 'cTrader Demo', platform: 'ctrader', account_id: '200002', api_token_encrypted: 'cipher2', is_active: true, execution_enabled: true, safety_policy: { enabled: true, killSwitch: true, maxRiskPercent: 1 } },
      { id: 'acc-3', workspace_id: 'ws-1', account_label: 'Paused', platform: 'mt5', account_id: '300003', is_active: false, execution_enabled: true, safety_policy: { enabled: false, killSwitch: false } },
      { id: 'acc-other', workspace_id: 'ws-2', account_label: 'Other tenant', platform: 'mt5', is_active: false, execution_enabled: false, safety_policy: { enabled: false, killSwitch: true } },
    ],
  });

  const store = createAdminOperationsStore(supabase, { nowFn: () => new Date(now) });
  const result = await store.snapshot('ws-1');

  assert.equal(result.workspaceId, 'ws-1');
  assert.equal(result.observedAt, now);
  assert.deepEqual(result.deliveries.counts, { PENDING: 1, SUCCEEDED: 1, RETRYABLE: 2, UNCERTAIN: 1, FAILED: 1 });
  assert.equal(result.deliveries.overdueRetryable, 1);
  assert.equal(result.deliveries.recentFailures.length, 3);
  assert.deepEqual(result.deliveries.recentFailures[0], {
    deliveryId: 'd-retry-due', tradingEventId: 'evt-1', destinationType: 'mt5', destinationRef: 'trade-account:acc-1',
    status: 'RETRYABLE', errorCode: 'MT5_TEMPORARY', failureClass: 'RETRYABLE', attemptCount: 2,
    nextAttemptAt: '2026-09-03T09:59:00Z', lastAttemptAt: null, updatedAt: '2026-09-03T09:59:30Z',
  });
  assert.equal(JSON.stringify(result).includes('secret-ish-key'), false);
  assert.equal(JSON.stringify(result).includes('cipher'), false);
  assert.equal(JSON.stringify(result).includes('100001'), false);
  assert.equal(JSON.stringify(result).includes('never'), false);
  assert.deepEqual(result.accountSafety.blocked, [
    { tradeAccountId: 'acc-1', label: 'MT5 Demo', platform: 'mt5', reasons: ['ACCOUNT_EXECUTION_DISABLED'] },
    { tradeAccountId: 'acc-2', label: 'cTrader Demo', platform: 'ctrader', reasons: ['KILL_SWITCH'] },
    { tradeAccountId: 'acc-3', label: 'Paused', platform: 'mt5', reasons: ['ACCOUNT_INACTIVE', 'ACCOUNT_POLICY_DISABLED'] },
  ]);
  assert.equal(result.accountSafety.blockedCount, 3);

  for (const query of supabase.queries) {
    if (query.table === 'destination_deliveries' || query.table === 'trade_accounts') {
      assert.equal(query.filters.some(([column, value]) => column === 'workspace_id' && value === 'ws-1'), true);
    }
  }
});
