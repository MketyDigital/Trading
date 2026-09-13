import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminOperationsStore } from '../src/http/v1_admin_operations.js';

function supabaseFixture() {
  const tables = {
    trading_events: [
      {
        id: 'evt-2', workspace_id: 'ws-1', source_connection_id: 'src-1', external_event_id: '102',
        source_type: 'telegram', source_external_id: 'chat:-100:102', received_at: '2026-09-13T10:02:00Z',
        processing_status: 'INTERPRETED', error_code: null, created_at: '2026-09-13T10:02:00Z',
        canonical_intent: {
          status: 'MANAGEMENT', source: 'deterministic', management: { type: 'MOVE_SL_TO_BE' },
          credential: 'never-leak',
        },
      },
      {
        id: 'evt-1', workspace_id: 'ws-1', source_connection_id: 'src-1', external_event_id: '101',
        source_type: 'telegram', source_external_id: 'chat:-100:101', received_at: '2026-09-13T10:01:00Z',
        processing_status: 'INTERPRETED', error_code: null, created_at: '2026-09-13T10:01:00Z',
        canonical_intent: {
          status: 'READY', source: 'deterministic_relaxed',
          intent: {
            symbol: { canonical: 'XAUUSD' }, side: 'BUY', orderType: 'MARKET',
            entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490, takeProfits: [2510, 2520],
          },
          normalization: { repaired: false },
          api_token: 'never-leak-either',
        },
      },
      {
        id: 'evt-other', workspace_id: 'ws-2', source_connection_id: 'src-other', external_event_id: '999',
        source_type: 'telegram', received_at: '2026-09-13T10:03:00Z', processing_status: 'INTERPRETED',
        canonical_intent: { status: 'READY', intent: { symbol: { canonical: 'BTCUSD' }, side: 'SELL' } },
      },
    ],
    source_connections: [
      { id: 'src-1', workspace_id: 'ws-1', display_name: 'Primary Signals', source_instance_id: 'listener-1', provider_type: 'external_mtproto', source_type: 'telegram' },
      { id: 'src-other', workspace_id: 'ws-2', display_name: 'Other tenant' },
    ],
    position_groups: [
      {
        id: 'grp-1', workspace_id: 'ws-1', trade_account_id: 'acc-1', source_event_id: 'evt-1',
        source_event_ids: ['evt-1', 'evt-2'], correlation_key: 'corr-1', canonical_symbol: 'XAUUSD',
        side: 'BUY', order_type: 'MARKET', status: 'OPEN', updated_at: '2026-09-13T10:02:01Z',
      },
      { id: 'grp-other', workspace_id: 'ws-2', trade_account_id: 'acc-other', source_event_id: 'evt-other', source_event_ids: ['evt-other'], canonical_symbol: 'BTCUSD' },
    ],
    trade_accounts: [
      { id: 'acc-1', workspace_id: 'ws-1', account_label: 'MT5 Demo', platform: 'mt5', is_active: true, execution_enabled: false, safety_policy: { enabled: true, killSwitch: true } },
      { id: 'acc-other', workspace_id: 'ws-2', account_label: 'Other tenant', platform: 'mt5', is_active: true, execution_enabled: true, safety_policy: {} },
    ],
    destination_deliveries: [
      { id: 'd-1', workspace_id: 'ws-1', trading_event_id: 'evt-1', destination_type: 'mt5', destination_ref: 'trade-account:acc-1', status: 'SUCCEEDED', error_code: null, failure_class: null, attempt_count: 1, updated_at: '2026-09-13T10:01:02Z' },
      { id: 'd-2', workspace_id: 'ws-1', trading_event_id: 'evt-2', destination_type: 'mt5', destination_ref: 'trade-account:acc-1', status: 'SUCCEEDED', error_code: 'STATE_BIND_FAILED', failure_class: 'STATE_BINDING_PENDING', attempt_count: 1, updated_at: '2026-09-13T10:02:02Z' },
      { id: 'd-other', workspace_id: 'ws-2', trading_event_id: 'evt-other', destination_type: 'mt5', status: 'FAILED', error_code: 'OTHER_TENANT' },
    ],
  };

  const queries = [];
  return {
    queries,
    from(table) {
      const state = { table, filters: [], inFilters: [], containsFilters: [], selected: '*', options: {}, order: null, limit: null };
      queries.push(state);
      const chain = {
        select(columns, options = {}) { state.selected = columns; state.options = options; return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        in(column, values) { state.inFilters.push([column, values]); return chain; },
        contains(column, values) { state.containsFilters.push([column, values]); return chain; },
        lte() { return chain; },
        order(column, options = {}) { state.order = [column, options]; return chain; },
        limit(value) { state.limit = value; return chain; },
        then(resolve, reject) {
          try {
            let rows = [...(tables[table] || [])];
            for (const [column, value] of state.filters) rows = rows.filter((row) => String(row[column]) === String(value));
            for (const [column, values] of state.inFilters) rows = rows.filter((row) => values.map(String).includes(String(row[column])));
            for (const [column, values] of state.containsFilters) rows = rows.filter((row) => Array.isArray(row[column]) && values.every((value) => row[column].map(String).includes(String(value))));
            if (state.order) {
              const [column, options] = state.order;
              rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (options.ascending === false ? -1 : 1));
            }
            if (Number.isInteger(state.limit)) rows = rows.slice(0, state.limit);
            const result = state.options?.head === true ? { data: null, count: rows.length, error: null } : { data: rows, error: null };
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

test('operations snapshot exposes bounded sanitized recent trading lifecycle evidence', async () => {
  const supabase = supabaseFixture();
  const result = await createAdminOperationsStore(supabase, {
    nowFn: () => new Date('2026-09-13T10:05:00Z'),
    recentLimit: 10,
  }).snapshot('ws-1');

  assert.equal(result.recentEvents.length, 2);
  assert.equal(result.recentEvents[0].eventId, 'evt-2');
  assert.equal(result.recentEvents[0].parserSource, 'deterministic');
  assert.equal(result.recentEvents[0].source.displayName, 'Primary Signals');
  assert.equal(result.recentEvents[0].correlation.kind, 'MATCHED_EXISTING_GROUP');
  assert.equal(result.recentEvents[0].correlation.positionGroupId, 'grp-1');
  assert.equal(result.recentEvents[0].destinations[0].tradeAccountId, 'acc-1');
  assert.equal(result.recentEvents[0].destinations[0].platform, 'mt5');
  assert.equal(result.recentEvents[0].deliveries[0].reconciliationStatus, 'STATE_BINDING_PENDING');
  assert.equal(result.recentEvents[0].drilldownEventId, 'evt-2');

  assert.equal(result.recentEvents[1].canonicalSymbol, 'XAUUSD');
  assert.equal(result.recentEvents[1].side, 'BUY');
  assert.equal(result.recentEvents[1].orderType, 'MARKET');
  assert.deepEqual(result.recentEvents[1].numericInterpretation, {
    entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490, takeProfits: [2510, 2520], normalization: { repaired: false },
  });

  const serialized = JSON.stringify(result.recentEvents);
  assert.equal(serialized.includes('never-leak'), false);
  assert.equal(serialized.includes('OTHER_TENANT'), false);
  assert.equal(serialized.includes('Other tenant'), false);

  for (const query of supabase.queries) {
    if (['trading_events', 'source_connections', 'position_groups', 'trade_accounts', 'destination_deliveries'].includes(query.table)) {
      assert.equal(query.filters.some(([column, value]) => column === 'workspace_id' && value === 'ws-1'), true, `${query.table} must be workspace-scoped`);
    }
  }
});
