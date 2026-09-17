import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminOperationsStore } from '../src/http/v1_admin_operations.js';

function auditDb() {
  const tables = {
    trading_events: [{
      id: 'evt-1', workspace_id: 'ws-1', source_connection_id: 'src-1', external_event_id: 'native-1',
      event_version: '1.0', source_type: 'telegram', source_external_id: 'chat:-100:1',
      occurred_at: '2026-09-13T10:00:00Z', received_at: '2026-09-13T10:00:01Z', processing_status: 'INTERPRETED',
      canonical_intent: {
        status: 'READY', source: 'deterministic',
        intent: { symbol: { canonical: 'XAUUSD', source: 'GOLD' }, side: 'BUY', orderType: 'MARKET' },
      },
      error_code: null, created_at: '2026-09-13T10:00:01Z',
    }],
    source_connections: [{
      id: 'src-1', workspace_id: 'ws-1', source_type: 'telegram', source_family: 'telegram',
      provider_type: 'external_mtproto', source_instance_id: 'listener-1', display_name: 'Signals', external_identity: 'telegram:1',
    }],
    position_groups: [{
      id: 'group-1', workspace_id: 'ws-1', trade_account_id: 'acct-1', source_event_id: 'evt-1',
      source_event_ids: ['evt-1', 'evt-followup'], source_instance_id: 'listener-1', correlation_key: 'listener-1:XAUUSD:BUY',
      canonical_symbol: 'XAUUSD', side: 'BUY', order_type: 'MARKET', stop_loss: 2500,
      status: 'OPEN', incomplete: false, position_mode: 'HEDGED', created_at: '2026-09-13T10:00:02Z', updated_at: '2026-09-13T10:00:03Z',
    }],
    position_legs: [{
      id: 'leg-1', workspace_id: 'ws-1', position_group_id: 'group-1', target_index: 1, lots: 0.01,
      stop_loss: 2500, take_profit: 2520, status: 'OPEN', broker_position_id: 'pos-77', broker_order_id: 'ord-88',
      opened_at: '2026-09-13T10:00:03Z', closed_at: null, created_at: '2026-09-13T10:00:02Z', updated_at: '2026-09-13T10:00:03Z',
    }],
    destination_deliveries: [],
    operation_journal: [{
      id: 'oj-1', workspace_id: 'ws-1', evidence_key: 'evt-1:interpretation', correlation_id: 'telegram:-100:1',
      trading_event_id: 'evt-1', source_connection_id: 'src-internal', ai_provider_id: 'provider-internal', connector_id: 'connector-internal',
      stage: 'INTERPRETATION', operation: 'interpret_event', status: 'SUCCEEDED', error_code: null, failure_class: null,
      retryable: false, summary: 'Interpretation ready.',
      details: { source: 'ai', aiDiagnostics: { attempts: [{ providerType: 'openai', status: 'SUCCEEDED' }] }, api_key: 'never', raw_body: 'never-raw' },
      observed_at: '2026-09-13T10:00:01.500Z', created_at: '2026-09-13T10:00:01.500Z',
    }, {
      id: 'oj-other', workspace_id: 'ws-2', evidence_key: 'other', correlation_id: 'other', trading_event_id: 'evt-1',
      stage: 'BROKER_EXECUTION', operation: 'execute_plan', status: 'FAILED', summary: 'other tenant', details: { safe: 'cross-tenant-never' },
      observed_at: '2026-09-13T10:00:02Z', created_at: '2026-09-13T10:00:02Z',
    }],
  };

  return {
    from(table) {
      const state = { filters: [], containsFilters: [], inFilters: [] };
      const chain = {
        select() { return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        contains(column, values) { state.containsFilters.push([column, values]); return chain; },
        in(column, values) { state.inFilters.push([column, values]); return chain; },
        order() { return chain; },
        async maybeSingle() { return { data: evaluate()[0] || null, error: null }; },
        then(resolve, reject) { return Promise.resolve({ data: evaluate(), error: null }).then(resolve, reject); },
      };
      function evaluate() {
        let rows = [...(tables[table] || [])];
        for (const [column, value] of state.filters) rows = rows.filter((row) => String(row[column]) === String(value));
        for (const [column, values] of state.containsFilters) {
          rows = rows.filter((row) => Array.isArray(row[column]) && values.every((value) => row[column].map(String).includes(String(value))));
        }
        for (const [column, values] of state.inFilters) rows = rows.filter((row) => values.map(String).includes(String(row[column])));
        return rows;
      }
      return chain;
    },
  };
}

test('event audit exposes parser provenance, lifecycle evidence, and durable reconciliation without reconstruction', async () => {
  const audit = await createAdminOperationsStore(auditDb()).auditEvent('ws-1', 'evt-1');

  assert.equal(audit.event.canonicalIntent.source, 'deterministic');
  assert.equal(audit.event.canonicalIntent.intent.symbol.canonical, 'XAUUSD');
  assert.equal(audit.positionGroups.length, 1);

  const group = audit.positionGroups[0];
  assert.equal(group.tradeAccountId, 'acct-1');
  assert.equal(group.canonicalSymbol, 'XAUUSD');
  assert.equal(group.correlationKey, 'listener-1:XAUUSD:BUY');
  assert.deepEqual(group.sourceEventIds, ['evt-1', 'evt-followup']);
  assert.equal(group.legs[0].brokerPositionId, 'pos-77');
  assert.equal(group.legs[0].brokerOrderId, 'ord-88');

  assert.deepEqual(audit.operationTimeline, [{
    tradingEventId: 'evt-1',
    correlationId: 'telegram:-100:1',
    stage: 'INTERPRETATION',
    operation: 'interpret_event',
    status: 'SUCCEEDED',
    errorCode: null,
    failureClass: null,
    retryable: false,
    summary: 'Interpretation ready.',
    details: { source: 'ai', aiDiagnostics: { attempts: [{ providerType: 'openai', status: 'SUCCEEDED' }] } },
    observedAt: '2026-09-13T10:00:01.500Z',
  }]);

  const encoded = JSON.stringify(audit);
  for (const forbidden of ['src-internal', 'provider-internal', 'connector-internal', 'never-raw', 'cross-tenant-never']) {
    assert.equal(encoded.includes(forbidden), false, forbidden);
  }
});
