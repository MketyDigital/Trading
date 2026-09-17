import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMketyAdminOperationsStore,
  handleMketyAdminOperationsRequest,
} from '../src/http/v1_mkety_admin_operations.js';
import { renderMketyAdminOperationsPage } from '../src/dashboard_mkety_admin_operations.js';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

function request(path, { secret = null } = {}) {
  const headers = secret ? { 'X-Mkety-Admin-Secret': secret } : {};
  return new Request(`https://trade.mkety.com${path}`, { headers });
}

function fakeOperationsSupabase(rows = []) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, 'operation_journal');
      const filters = [];
      const chain = {
        select(columns) { calls.push(['select', columns]); return chain; },
        eq(column, value) { filters.push(['eq', column, value]); calls.push(['eq', column, value]); return chain; },
        gte(column, value) { filters.push(['gte', column, value]); calls.push(['gte', column, value]); return chain; },
        lte(column, value) { filters.push(['lte', column, value]); calls.push(['lte', column, value]); return chain; },
        lt(column, value) { filters.push(['lt', column, value]); calls.push(['lt', column, value]); return chain; },
        order(column, options) { calls.push(['order', column, options]); return chain; },
        async limit(value) {
          calls.push(['limit', value]);
          return { data: rows, error: null };
        },
      };
      return chain;
    },
  };
}

const journalRow = {
  id: 'op-1',
  workspace_id: 'ws-1',
  evidence_key: 'telegram:-100:10:broker',
  correlation_id: 'telegram:-100:10',
  trading_event_id: 'evt-1',
  source_connection_id: 'src-1',
  source_feed_id: 'feed-1',
  route_id: 'route-1',
  destination_id: 'dest-1',
  trade_account_id: 'acct-1',
  ai_provider_id: 'ai-1',
  position_group_id: 'group-1',
  connector_id: 'connector-1',
  stage: 'BROKER_EXECUTION',
  operation: 'execute_plan',
  status: 'FAILED',
  error_code: 'TRADING_BAD_STOPS',
  failure_class: 'BROKER_REJECTED',
  retryable: false,
  summary: 'Broker rejected request. token=top-secret',
  details: {
    httpStatus: 400,
    providerCode: 'TRADING_BAD_STOPS',
    authorization: 'Bearer secret-value',
    api_key: 'plain-secret',
    nested: { password: 'secret-pass', safe: 'visible' },
    stack: 'internal stack should not render',
  },
  observed_at: '2026-09-17T08:00:00.000Z',
};

test('Mkety staff operations API requires the existing admin secret', async () => {
  const denied = await handleMketyAdminOperationsRequest(
    request('/api/v1/mkety-admin/operations'),
    { MKETY_TRADING_ADMIN_SECRET: 'staff-secret' },
    { supabaseFactory: async () => fakeOperationsSupabase() },
  );
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).reason, 'MKETY_ADMIN_UNAUTHORIZED');
});

test('staff operations store supports site-wide support filters and redacts secrets again at read time', async () => {
  const supabase = fakeOperationsSupabase([journalRow]);
  const rows = await createMketyAdminOperationsStore(supabase).list({
    workspaceId: 'ws-1',
    sourceConnectionId: 'src-1',
    sourceFeedId: 'feed-1',
    routeId: 'route-1',
    destinationId: 'dest-1',
    tradeAccountId: 'acct-1',
    aiProviderId: 'ai-1',
    stage: 'BROKER_EXECUTION',
    status: 'FAILED',
    correlationId: 'telegram:-100:10',
    from: '2026-09-17T07:00:00.000Z',
    to: '2026-09-17T09:00:00.000Z',
    before: '2026-09-17T10:00:00.000Z',
    limit: 25,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].workspaceId, 'ws-1');
  assert.equal(rows[0].correlationId, 'telegram:-100:10');
  assert.equal(rows[0].details.httpStatus, 400);
  assert.equal(rows[0].details.nested.safe, 'visible');
  assert.equal(rows[0].details.authorization, '[REDACTED]');
  assert.equal(rows[0].details.api_key, '[REDACTED]');
  assert.equal(rows[0].details.nested.password, '[REDACTED]');
  assert.equal('stack' in rows[0].details, false);
  assert.equal(rows[0].summary.includes('top-secret'), false);

  for (const [method, column] of supabase.calls.filter((call) => ['eq', 'gte', 'lte', 'lt'].includes(call[0]))) {
    assert.ok(method);
    assert.ok(column);
  }
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'workspace_id' && call[2] === 'ws-1'));
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'ai_provider_id' && call[2] === 'ai-1'));
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'status' && call[2] === 'FAILED'));
  assert.ok(supabase.calls.some((call) => call[0] === 'order' && call[1] === 'observed_at'));
  assert.ok(supabase.calls.some((call) => call[0] === 'limit' && call[1] === 25));
});

test('staff operations API returns sanitized site-wide evidence with correlation pagination', async () => {
  const supabase = fakeOperationsSupabase([journalRow]);
  const response = await handleMketyAdminOperationsRequest(
    request('/api/v1/mkety-admin/operations?workspaceId=ws-1&status=FAILED&correlationId=telegram%3A-100%3A10&limit=25', { secret: 'staff-secret' }),
    { MKETY_TRADING_ADMIN_SECRET: 'staff-secret' },
    { supabaseFactory: async () => supabase },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.operations.length, 1);
  assert.equal(body.operations[0].workspaceId, 'ws-1');
  assert.equal(body.nextBefore, journalRow.observed_at);
  assert.equal(JSON.stringify(body).includes('top-secret'), false);
});

test('Mkety staff diagnostics page exposes support filters and never persists the staff secret', () => {
  const html = renderMketyAdminOperationsPage();
  assert.match(html, /Mkety Operations Diagnostics/);
  assert.match(html, /id="staffSecret"/);
  assert.match(html, /id="workspaceId"/);
  assert.match(html, /id="sourceConnectionId"/);
  assert.match(html, /id="sourceFeedId"/);
  assert.match(html, /id="routeId"/);
  assert.match(html, /id="destinationId"/);
  assert.match(html, /id="tradeAccountId"/);
  assert.match(html, /id="aiProviderId"/);
  assert.match(html, /id="correlationId"/);
  assert.match(html, /id="stage"/);
  assert.match(html, /id="status"/);
  assert.match(html, /\/api\/v1\/mkety-admin\/operations/);
  assert.match(html, /correlation ID/i);
  assert.equal(/localStorage\.setItem\([^)]*staffSecret/i.test(html), false);
  assert.equal(/sessionStorage\.setItem\([^)]*staffSecret/i.test(html), false);
});

test('V1 entrypoint serves and routes the dedicated staff operations surface separately from tenant admin', async () => {
  let apiCalled = false;
  const worker = createTradingV1Entrypoint({
    mketyAdminOperationsHandler: async () => {
      apiCalled = true;
      return new Response(JSON.stringify({ ok: true, operations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const page = await worker.fetch(new Request('https://trade.mkety.com/mkety-admin/operations'), {}, {});
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Mkety Operations Diagnostics/);

  const api = await worker.fetch(new Request('https://trade.mkety.com/api/v1/mkety-admin/operations'), {}, {});
  assert.equal(api.status, 200);
  assert.equal(apiCalled, true);
});
