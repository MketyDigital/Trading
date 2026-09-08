import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1EventsRequest } from '../src/http/v1_events.js';
import { handleV1AdminRequest } from '../src/http/v1_admin.js';
import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';
import { createAdminOperationsStore } from '../src/http/v1_admin_operations.js';

function signedV1Request(externalEventId) {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: JSON.stringify({
      external_event_id: externalEventId,
      source: { type: 'telegram_mtproto', instance_id: 'mtproto-listener-1' },
      text: 'BUY XAUUSD 2500 SL 2490 TP 2510',
      thread: { thread_id: 'duplicate-thread' },
    }),
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Source-Id': 'source-telegram-1',
      'X-Mkety-Timestamp': '1800000000000',
      'X-Mkety-Signature': 'v1=test-signature',
    },
  });
}

const event = {
  workspace_hint: 'workspace-idempotency',
  external_event_id: 'telegram-msg-duplicate',
  source: { type: 'telegram_mtproto', instance_id: 'mtproto-listener-1' },
  text: 'BUY XAUUSD 2500 SL 2490 TP 2510',
  thread: { thread_id: 'duplicate-thread' },
};

const interpretation = {
  status: 'READY',
  intent: {
    side: 'BUY',
    orderType: 'MARKET',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 },
    stopLoss: 2490,
    takeProfits: [2510],
  },
};

const simulatedPlan = {
  status: 'SIMULATED',
  executionEnabled: false,
  correlation: { status: 'NEW_GROUP' },
  actions: [],
  accounts: [
    {
      accountId: 'ctrader-demo-account',
      groupId: 'db-event-duplicate:ctrader-demo-account',
      status: 'READY',
      actions: [
        { type: 'OPEN_POSITION', symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET', lots: 0.01, targetIndex: 1, simulated: true },
      ],
    },
  ],
};

test('duplicate source event keeps one persistent identity and does not run destination execution twice', async () => {
  let ingestCalls = 0;
  let executionCalls = 0;
  const commonOptions = {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => {
      ingestCalls += 1;
      return ingestCalls === 1
        ? { ok: true, duplicate: false, eventId: 'db-event-duplicate', event, interpretation }
        : { ok: true, duplicate: true, eventId: 'db-event-duplicate', event, interpretation };
    },
    simulationDepsFactory: async () => ({}),
    orchestrateFn: async () => structuredClone(simulatedPlan),
    brokerExecutionControlResolver: async () => ({
      ok: true,
      enabled: true,
      reason: 'TEST_ENABLED',
    }),
    executionStageFn: async (stageInput) => runV1ProductionExecutionStage({
      ...stageInput,
      safeSimulationDepsFactory: async () => ({ safeSimulationOnly: true }),
      executeProductionFn: async (input) => {
        executionCalls += 1;
        return {
          executionEnabled: true,
          status: 'EXECUTED',
          succeeded: 1,
          failed: 0,
          accounts: [{ accountId: input.accountPlans[0].accountId, status: 'SUCCESS' }],
        };
      },
    }),
  };
  const env = {
    TRADING_MASTER_KEY: 'test-master-key',
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
    TRADING_EXECUTION_TRANSPORT_MODE: 'simulation',
  };

  const first = await handleV1EventsRequest(signedV1Request('telegram-msg-duplicate'), env, commonOptions);
  const second = await handleV1EventsRequest(signedV1Request('telegram-msg-duplicate'), env, commonOptions);
  const firstBody = await first.json();
  const secondBody = await second.json();

  assert.equal(first.status, 200);
  assert.equal(firstBody.ok, true);
  assert.equal(firstBody.duplicate, false);
  assert.equal(firstBody.eventId, 'db-event-duplicate');
  assert.equal(firstBody.execution.status, 'EXECUTED');
  assert.equal(firstBody.execution.transportMode, 'simulation');

  assert.equal(second.status, 200);
  assert.equal(secondBody.ok, true);
  assert.equal(secondBody.duplicate, true);
  assert.equal(secondBody.eventId, 'db-event-duplicate');
  assert.equal(secondBody.simulation, undefined);
  assert.equal(secondBody.execution, undefined);
  assert.equal(executionCalls, 1);
});

function auditSupabase() {
  const tables = {
    trading_workspace_access: [
      { id: 'workspace-audit', display_name: 'Audit Workspace', trading_access_enabled: true, trading_required_role: 'trading_admin' },
    ],
    trading_events: [
      {
        id: 'db-event-audit',
        workspace_id: 'workspace-audit',
        source_connection_id: 'source-provider-audit',
        external_event_id: 'provider-account-event-1',
        event_version: '1.0',
        source_type: 'ctrader',
        source_external_id: 'ctrader:account:777',
        occurred_at: '2026-09-06T10:00:00Z',
        received_at: '2026-09-06T10:00:01Z',
        processing_status: 'INTERPRETED',
        canonical_intent: {
          status: 'READY',
          intent: { symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET' },
          credential: 'must-not-leak',
        },
        raw_text: 'raw provider payload must not leak',
        structured_payload: { access_token: 'must-not-leak' },
        metadata: { api_key: 'must-not-leak' },
        created_at: '2026-09-06T10:00:01Z',
      },
    ],
    source_connections: [
      {
        id: 'source-provider-audit',
        workspace_id: 'workspace-audit',
        source_type: 'ctrader',
        source_family: 'provider_account',
        provider_type: 'ctrader_source',
        source_instance_id: 'ctrader-source-1',
        display_name: 'cTrader Provider Account',
        external_identity: 'ctrader:account:777',
        secret_ciphertext: 'ciphertext-must-not-leak',
        config: { password: 'must-not-leak' },
      },
    ],
    position_groups: [
      {
        id: 'position-group-audit',
        workspace_id: 'workspace-audit',
        trade_account_id: 'ctrader-demo-account',
        source_event_id: 'db-event-audit',
        source_event_ids: ['db-event-audit'],
        source_instance_id: 'ctrader-source-1',
        correlation_key: 'provider-account-event-1:ctrader-demo-account',
        canonical_symbol: 'XAUUSD',
        side: 'BUY',
        order_type: 'MARKET',
        stop_loss: 2490,
        status: 'OPEN',
        incomplete: false,
        position_mode: 'HEDGED',
        policy_snapshot: { token: 'must-not-leak' },
        created_at: '2026-09-06T10:00:02Z',
        updated_at: '2026-09-06T10:00:03Z',
      },
    ],
    position_legs: [
      {
        id: 'leg-audit-1',
        workspace_id: 'workspace-audit',
        position_group_id: 'position-group-audit',
        target_index: 1,
        lots: 0.01,
        stop_loss: 2490,
        take_profit: 2510,
        status: 'OPEN',
        broker_position_id: 'sim-ctrader-position-1',
        broker_order_id: 'sim-ctrader-order-1',
        created_at: '2026-09-06T10:00:02Z',
        updated_at: '2026-09-06T10:00:03Z',
      },
    ],
    destination_deliveries: [
      {
        id: 'delivery-audit-1',
        workspace_id: 'workspace-audit',
        trading_event_id: 'db-event-audit',
        destination_type: 'ctrader',
        destination_ref: 'trade-account:ctrader-demo-account',
        status: 'SUCCEEDED',
        error_code: null,
        failure_class: null,
        attempt_count: 1,
        response_payload: { access_token: 'must-not-leak' },
        request_payload: { password: 'must-not-leak' },
        idempotency_key: 'idem-must-not-leak',
        created_at: '2026-09-06T10:00:02Z',
        updated_at: '2026-09-06T10:00:03Z',
      },
    ],
  };

  const queries = [];
  return {
    queries,
    from(table) {
      const state = { table, filters: [], inFilters: [], containsFilters: [], order: null };
      queries.push(state);
      const chain = {
        select() { return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        in(column, values) { state.inFilters.push([column, values]); return chain; },
        contains(column, values) { state.containsFilters.push([column, values]); return chain; },
        order(column, options = {}) { state.order = [column, options]; return chain; },
        async maybeSingle() {
          const rows = evaluate();
          return { data: rows[0] || null, error: null };
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

test('simulated provider/account event is readable through the V1 event audit contract without leaking secrets', async () => {
  const supabase = auditSupabase();
  const response = await handleV1AdminRequest(new Request('https://trade.mkety.com/api/v1/admin/events/db-event-audit/audit', {
    method: 'GET',
    headers: {
      'X-Mkety-Workspace-Id': 'workspace-audit',
      Authorization: 'Bearer test-owner',
    },
  }), {
    TRADING_ACCESS_ENABLED: 'false',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {
    supabaseFactory: async () => supabase,
    authenticateFn: async () => ({ ok: true, subject: 'owner-1', workspaceId: 'workspace-audit' }),
    membershipStoreFactory: () => ({
      async getMembership(workspaceId, subject) {
        return { id: 'member-1', workspaceId, subject, role: 'owner', enabled: true };
      },
    }),
    operationsStoreFactory: (client) => createAdminOperationsStore(client),
  });

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.audit.workspaceId, 'workspace-audit');
  assert.equal(body.audit.event.eventId, 'db-event-audit');
  assert.equal(body.audit.event.externalEventId, 'provider-account-event-1');
  assert.equal(body.audit.source.sourceFamily, 'provider_account');
  assert.equal(body.audit.source.providerType, 'ctrader_source');
  assert.deepEqual(body.audit.positionGroups.map((group) => group.positionGroupId), ['position-group-audit']);
  assert.deepEqual(body.audit.positionGroups[0].legs.map((leg) => leg.brokerPositionId), ['sim-ctrader-position-1']);
  assert.deepEqual(body.audit.deliveries.map((delivery) => delivery.deliveryId), ['delivery-audit-1']);
  assert.equal(body.audit.deliveries[0].status, 'SUCCEEDED');

  const serialized = JSON.stringify(body);
  for (const forbidden of [
    'raw provider payload must not leak',
    'must-not-leak',
    'ciphertext-must-not-leak',
    'idem-must-not-leak',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `audit response leaked ${forbidden}`);
  }

  for (const query of supabase.queries) {
    if (['trading_events', 'source_connections', 'position_groups', 'position_legs', 'destination_deliveries'].includes(query.table)) {
      assert.equal(query.filters.some(([column, value]) => column === 'workspace_id' && value === 'workspace-audit'), true, `${query.table} must be workspace-scoped`);
    }
  }
});
