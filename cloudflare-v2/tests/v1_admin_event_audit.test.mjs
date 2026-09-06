import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1AdminRequest } from '../src/http/v1_admin.js';
import { createAdminOperationsStore } from '../src/http/v1_admin_operations.js';

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
  TRADING_ACCESS_ENABLED: 'false',
  BROKER_EXECUTION_ENABLED: 'false',
};

function membershipStore(role = 'admin') {
  return () => ({
    async getMembership(workspaceId, subject) {
      return { id: 'm1', workspaceId, subject, role, enabled: true };
    },
  });
}

function auditSupabase() {
  const tables = {
    trading_workspace_access: [workspace],
    trading_events: [
      {
        id: 'evt-1', workspace_id: 'ws-1', source_connection_id: 'src-1', external_event_id: 'native-77',
        event_version: '1.0', source_type: 'telegram', source_external_id: 'chat:-1001:77', occurred_at: '2026-09-03T09:00:00Z',
        received_at: '2026-09-03T09:00:01Z', processing_status: 'INTERPRETED',
        canonical_intent: { status: 'READY', intent: { symbol: 'XAUUSD', side: 'BUY' }, credential: 'must-not-leak', nested: { api_token: 'must-not-leak-either', safe: 'kept' } },
        error_code: null, created_at: '2026-09-03T09:00:01Z', raw_text: 'raw signal must not leak', structured_payload: { password: 'never' }, metadata: { token: 'never' },
      },
      { id: 'evt-1-other', workspace_id: 'ws-2', source_connection_id: 'src-other', external_event_id: 'native-77', processing_status: 'INTERPRETED' },
    ],
    source_connections: [
      { id: 'src-1', workspace_id: 'ws-1', source_type: 'telegram', source_family: 'telegram', provider_type: 'external_mtproto', source_instance_id: 'telegram-primary', display_name: 'Primary Signals', external_identity: 'telegram:acct-1', secret_ciphertext: 'source-secret-cipher', config: { password: 'never' } },
      { id: 'src-other', workspace_id: 'ws-2', source_type: 'telegram', source_family: 'telegram', provider_type: 'external_mtproto', source_instance_id: 'other' },
    ],
    position_groups: [
      { id: 'grp-1', workspace_id: 'ws-1', trade_account_id: 'acc-1', source_event_id: 'evt-1', source_event_ids: ['evt-1'], source_instance_id: 'telegram-primary', correlation_key: 'corr-1', canonical_symbol: 'XAUUSD', side: 'BUY', order_type: 'MARKET', stop_loss: 2400, status: 'OPEN', incomplete: false, position_mode: 'HEDGED', created_at: '2026-09-03T09:00:02Z', updated_at: '2026-09-03T09:00:03Z', policy_snapshot: { credential: 'never' } },
      { id: 'grp-2', workspace_id: 'ws-1', trade_account_id: 'acc-2', source_event_id: 'evt-old', source_event_ids: ['evt-old', 'evt-1'], source_instance_id: 'telegram-primary', correlation_key: 'corr-2', canonical_symbol: 'XAUUSD', side: 'BUY', order_type: 'MARKET', stop_loss: 2400, status: 'OPEN', incomplete: false, position_mode: 'NETTED', created_at: '2026-09-03T08:59:00Z', updated_at: '2026-09-03T09:00:04Z' },
      { id: 'grp-other', workspace_id: 'ws-2', source_event_id: 'evt-1', source_event_ids: ['evt-1'], canonical_symbol: 'XAUUSD', side: 'BUY', order_type: 'MARKET', status: 'OPEN' },
    ],
    position_legs: [
      { id: 'leg-1', workspace_id: 'ws-1', position_group_id: 'grp-1', target_index: 1, lots: 0.01, stop_loss: 2400, take_profit: 2420, status: 'OPEN', broker_position_id: 'broker-pos-1', broker_order_id: 'broker-order-1', opened_at: '2026-09-03T09:00:03Z', closed_at: null, created_at: '2026-09-03T09:00:02Z', updated_at: '2026-09-03T09:00:03Z' },
      { id: 'leg-2', workspace_id: 'ws-1', position_group_id: 'grp-2', target_index: 1, lots: 0.02, stop_loss: 2400, take_profit: 2430, status: 'OPEN', broker_position_id: 'broker-pos-2', broker_order_id: null, opened_at: '2026-09-03T09:00:04Z', closed_at: null, created_at: '2026-09-03T09:00:04Z', updated_at: '2026-09-03T09:00:04Z' },
      { id: 'leg-other', workspace_id: 'ws-2', position_group_id: 'grp-other', target_index: 1, lots: 99, status: 'OPEN', broker_position_id: 'other-tenant-position' },
    ],
    destination_deliveries: [
      { id: 'del-1', workspace_id: 'ws-1', trading_event_id: 'evt-1', destination_type: 'mt5', destination_ref: 'trade-account:acc-1', status: 'SUCCEEDED', error_code: null, failure_class: null, attempt_count: 1, next_attempt_at: null, last_attempt_at: '2026-09-03T09:00:02Z', created_at: '2026-09-03T09:00:02Z', updated_at: '2026-09-03T09:00:03Z', idempotency_key: 'idem-secret', request_payload: { password: 'request-secret' }, response_payload: { access_token: 'response-secret' } },
      { id: 'del-2', workspace_id: 'ws-1', trading_event_id: 'evt-1', destination_type: 'ctrader', destination_ref: 'trade-account:acc-2', status: 'RETRYABLE', error_code: 'TEMPORARY_NETWORK', failure_class: 'RETRYABLE', attempt_count: 2, next_attempt_at: '2026-09-03T09:05:00Z', last_attempt_at: '2026-09-03T09:01:00Z', created_at: '2026-09-03T09:00:02Z', updated_at: '2026-09-03T09:01:00Z', response_payload: { raw: 'broker raw must not leak' } },
      { id: 'del-other', workspace_id: 'ws-2', trading_event_id: 'evt-1', destination_type: 'mt5', destination_ref: 'other', status: 'FAILED', error_code: 'OTHER_TENANT' },
    ],
  };

  const queries = [];
  return {
    queries,
    from(table) {
      const state = { table, filters: [], inFilters: [], containsFilters: [], selected: '*', order: null };
      queries.push(state);
      const chain = {
        select(columns) { state.selected = columns; return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        in(column, values) { state.inFilters.push([column, values]); return chain; },
        contains(column, values) { state.containsFilters.push([column, values]); return chain; },
        order(column, options = {}) { state.order = [column, options]; return chain; },
        async maybeSingle() {
          const result = evaluate();
          return { data: result[0] || null, error: null };
        },
        then(resolve, reject) {
          try { return Promise.resolve({ data: evaluate(), error: null }).then(resolve, reject); }
          catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      function evaluate() {
        let rows = [...(tables[table] || [])];
        for (const [column, value] of state.filters) rows = rows.filter((row) => String(row[column]) === String(value));
        for (const [column, values] of state.inFilters) rows = rows.filter((row) => values.map(String).includes(String(row[column])));
        for (const [column, values] of state.containsFilters) rows = rows.filter((row) => Array.isArray(row[column]) && values.every((value) => row[column].map(String).includes(String(value))));
        if (state.order) {
          const [column, options] = state.order;
          rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (options.ascending === false ? -1 : 1));
        }
        return rows;
      }
      return chain;
    },
  };
}

async function requestAudit(supabase, { eventId = 'evt-1', method = 'GET', role = 'admin' } = {}) {
  return handleV1AdminRequest(new Request(`https://trade.mkety.com/api/v1/admin/events/${eventId}/audit`, {
    method,
    headers: {
      'X-Mkety-Workspace-Id': 'ws-1',
      Authorization: 'Bearer token',
    },
  }), env, {
    supabaseFactory: async () => supabase,
    authenticateFn: async () => ({ ok: true, subject: 'u1', workspaceId: 'ws-1' }),
    membershipStoreFactory: membershipStore(role),
    operationsStoreFactory: (client) => createAdminOperationsStore(client),
  });
}

test('event audit route correlates only persisted exact-workspace evidence and strips raw/secret delivery material', async () => {
  const supabase = auditSupabase();
  const response = await requestAudit(supabase);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.audit.workspaceId, 'ws-1');
  assert.equal(body.audit.event.eventId, 'evt-1');
  assert.equal(body.audit.event.externalEventId, 'native-77');
  assert.equal(body.audit.event.processingStatus, 'INTERPRETED');
  assert.deepEqual(body.audit.event.canonicalIntent, {
    status: 'READY',
    intent: { symbol: 'XAUUSD', side: 'BUY' },
    nested: { safe: 'kept' },
  });
  assert.deepEqual(body.audit.source, {
    sourceConnectionId: 'src-1', sourceType: 'telegram', sourceFamily: 'telegram', providerType: 'external_mtproto',
    sourceInstanceId: 'telegram-primary', displayName: 'Primary Signals', externalIdentity: 'telegram:acct-1',
  });
  assert.deepEqual(body.audit.positionGroups.map((group) => group.positionGroupId), ['grp-1', 'grp-2']);
  assert.deepEqual(body.audit.positionGroups[0].legs.map((leg) => leg.brokerPositionId), ['broker-pos-1']);
  assert.deepEqual(body.audit.positionGroups[1].legs.map((leg) => leg.brokerPositionId), ['broker-pos-2']);
  assert.deepEqual(body.audit.deliveries.map((delivery) => delivery.deliveryId), ['del-1', 'del-2']);
  assert.equal(body.audit.deliveries[1].failureClass, 'RETRYABLE');
  assert.deepEqual(body.audit.historyCoverage, { actorHistoryRecorded: false });

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'raw signal must not leak', 'must-not-leak', 'must-not-leak-either', 'source-secret-cipher',
    'idem-secret', 'request-secret', 'response-secret', 'broker raw must not leak', 'other-tenant-position', 'OTHER_TENANT',
  ]) assert.equal(serialized.includes(forbidden), false, `must not expose ${forbidden}`);

  for (const query of supabase.queries) {
    if (['trading_events', 'source_connections', 'position_groups', 'position_legs', 'destination_deliveries'].includes(query.table)) {
      assert.equal(query.filters.some(([column, value]) => column === 'workspace_id' && value === 'ws-1'), true, `${query.table} must be workspace-scoped`);
    }
  }
});

test('event audit is owner/admin GET-only, returns 404 for absent exact-workspace event, and never mutates execution state', async () => {
  const adminDb = auditSupabase();
  const operator = await requestAudit(adminDb, { role: 'operator' });
  assert.equal(operator.status, 403);

  const post = await requestAudit(auditSupabase(), { method: 'POST' });
  assert.equal(post.status, 405);

  const missing = await requestAudit(auditSupabase(), { eventId: 'missing-event' });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { ok: false, reason: 'TRADING_EVENT_NOT_FOUND' });

  assert.equal(env.TRADING_ACCESS_ENABLED, 'false');
  assert.equal(env.BROKER_EXECUTION_ENABLED, 'false');
});
