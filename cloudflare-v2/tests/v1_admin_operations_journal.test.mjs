import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdminOperationsStore } from '../src/http/v1_admin_operations.js';

function operationsDb({ journal = [] } = {}) {
  const queries = [];
  const rowsFor = (table) => table === 'operation_journal' ? journal : [];

  return {
    queries,
    from(table) {
      const state = {
        table,
        filters: [],
        inFilters: [],
        containsFilters: [],
        lteFilters: [],
        order: null,
        limit: null,
        options: {},
      };
      queries.push(state);

      const chain = {
        select(_columns, options = {}) { state.options = options || {}; return chain; },
        eq(column, value) { state.filters.push([column, value]); return chain; },
        in(column, values) { state.inFilters.push([column, values]); return chain; },
        contains(column, values) { state.containsFilters.push([column, values]); return chain; },
        lte(column, value) { state.lteFilters.push([column, value]); return chain; },
        order(column, options = {}) { state.order = [column, options]; return chain; },
        limit(value) { state.limit = value; return chain; },
        maybeSingle() {
          return execute().then((result) => ({ data: result.data?.[0] ?? null, error: result.error }));
        },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };

      async function execute() {
        let rows = rowsFor(table).map((row) => structuredClone(row));
        for (const [column, value] of state.filters) {
          rows = rows.filter((row) => String(row[column]) === String(value));
        }
        for (const [column, values] of state.inFilters) {
          const allowed = values.map(String);
          rows = rows.filter((row) => allowed.includes(String(row[column])));
        }
        for (const [column, values] of state.containsFilters) {
          rows = rows.filter((row) => Array.isArray(row[column]) && values.every((value) => row[column].map(String).includes(String(value))));
        }
        for (const [column, value] of state.lteFilters) {
          rows = rows.filter((row) => row[column] != null && new Date(row[column]).getTime() <= new Date(value).getTime());
        }
        if (state.order) {
          const [column, options] = state.order;
          rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (options.ascending === false ? -1 : 1));
        }
        if (Number.isInteger(state.limit)) rows = rows.slice(0, state.limit);
        if (state.options?.head === true) return { data: null, count: rows.length, error: null };
        return { data: rows, count: state.options?.count ? rows.length : null, error: null };
      }

      return chain;
    },
  };
}

const journalRows = [
  {
    id: 'oj-1',
    workspace_id: 'ws-1',
    evidence_key: 'telegram:-100123:317:rev-a:interpretation',
    correlation_id: 'telegram:-100123:317',
    trading_event_id: 'evt-1',
    source_connection_id: 'source-secret-internal-id',
    ai_provider_id: 'provider-secret-internal-id',
    connector_id: 'connector-internal-id',
    stage: 'INTERPRETATION',
    operation: 'interpret_event',
    status: 'SUCCEEDED',
    error_code: null,
    failure_class: null,
    retryable: false,
    summary: 'Interpretation ready api_key=sk-summary-never-show.',
    details: {
      source: 'ai',
      aiDiagnostics: {
        attempts: [{ providerType: 'openai', model: 'gpt-test', latencyMs: 44, status: 'SUCCEEDED' }],
      },
      authorization: 'Bearer never-show',
      api_key: 'sk-never-show',
      raw_body: 'raw-provider-body-never-show',
      stack: 'internal stack never show',
      nested: { password: 'never-show', safe: 'kept' },
    },
    observed_at: '2026-09-17T07:30:00.000Z',
    created_at: '2026-09-17T07:30:00.000Z',
  },
  {
    id: 'oj-2',
    workspace_id: 'ws-2',
    evidence_key: 'other-tenant',
    correlation_id: 'other',
    trading_event_id: 'evt-other',
    stage: 'BROKER_EXECUTION',
    operation: 'execute_plan',
    status: 'FAILED',
    summary: 'Other tenant evidence.',
    details: { safe: 'must-not-cross-workspaces' },
    observed_at: '2026-09-17T07:31:00.000Z',
  },
];

test('operations snapshot adds a workspace-scoped customer-safe lifecycle timeline', async () => {
  const supabase = operationsDb({ journal: journalRows });
  const result = await createAdminOperationsStore(supabase, {
    nowFn: () => new Date('2026-09-17T07:40:00.000Z'),
    recentLimit: 10,
  }).snapshot('ws-1');

  assert.ok(Array.isArray(result.operationTimeline));
  assert.equal(result.operationTimeline.length, 1);
  assert.deepEqual(result.operationTimeline[0], {
    tradingEventId: 'evt-1',
    correlationId: 'telegram:-100123:317',
    stage: 'INTERPRETATION',
    operation: 'interpret_event',
    status: 'SUCCEEDED',
    errorCode: null,
    failureClass: null,
    retryable: false,
    summary: 'Interpretation ready api_key=[REDACTED]',
    details: {
      source: 'ai',
      aiDiagnostics: {
        attempts: [{ providerType: 'openai', model: 'gpt-test', latencyMs: 44, status: 'SUCCEEDED' }],
      },
      nested: { safe: 'kept' },
    },
    observedAt: '2026-09-17T07:30:00.000Z',
  });

  const encoded = JSON.stringify(result);
  for (const forbidden of [
    'source-secret-internal-id',
    'provider-secret-internal-id',
    'connector-internal-id',
    'Bearer never-show',
    'sk-never-show',
    'sk-summary-never-show',
    'raw-provider-body-never-show',
    'internal stack never show',
    'never-show',
    'must-not-cross-workspaces',
  ]) {
    assert.equal(encoded.includes(forbidden), false, forbidden);
  }

  const journalQuery = supabase.queries.find((query) => query.table === 'operation_journal');
  assert.ok(journalQuery);
  assert.equal(journalQuery.filters.some(([column, value]) => column === 'workspace_id' && value === 'ws-1'), true);
  assert.deepEqual(journalQuery.order, ['observed_at', { ascending: false }]);
  assert.equal(journalQuery.limit, 10);
});
