import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1AdminLogicalRoutesRequest } from '../src/http/v1_admin_logical_routes.js';

function jsonRequest(body) {
  return new Request('https://trade.mkety.com/api/v1/admin/logical-routes/reconcile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authorization() {
  return {
    ok: true,
    workspace: { id: 'ws-1' },
    membership: { role: 'owner', enabled: true },
    auth: { subject: 'test-owner' },
  };
}

function makeSupabase() {
  const tables = {
    source_connections: [{ id: 'source-main', workspace_id: 'ws-1' }],
    trading_destinations: [{ id: 'dest-mt5', workspace_id: 'ws-1', destination_type: 'broker_account' }],
    source_feeds: [
      { id: 'feed-a', workspace_id: 'ws-1', source_connection_id: 'source-main', is_active: true },
      { id: 'feed-b', workspace_id: 'ws-1', source_connection_id: 'source-main', is_active: true },
    ],
    source_destination_routes: [
      {
        id: 'route-gold', workspace_id: 'ws-1', source_connection_id: 'source-main', source_feed_id: 'feed-a',
        destination_id: 'dest-mt5', route_name: 'Gold only', priority: 10, is_active: true,
        filters: { allowedCanonicalSymbols: ['XAUUSD'] },
      },
      {
        id: 'route-synthetic', workspace_id: 'ws-1', source_connection_id: 'source-main', source_feed_id: 'feed-b',
        destination_id: 'dest-mt5', route_name: 'Synthetic only', priority: 20, is_active: true,
        filters: { allowedCanonicalSymbols: ['DERIV:VOLATILITY_75'] },
      },
    ],
  };

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function query(table) {
    const state = { filters: [], inFilter: null, mutation: null };
    const apply = () => tables[table].filter((row) => state.filters.every(([key, value]) => String(row[key]) === String(value))
      && (!state.inFilter || state.inFilter[1].map(String).includes(String(row[state.inFilter[0]]))));
    const api = {
      select() { return api; },
      eq(key, value) { state.filters.push([key, value]); return api; },
      in(key, values) { state.inFilter = [key, values]; return api; },
      order() { return Promise.resolve({ data: clone(apply()), error: null }); },
      maybeSingle() { return Promise.resolve({ data: clone(apply()[0] || null), error: null }); },
      update(patch) { state.mutation = ['update', patch]; return api; },
      delete() { state.mutation = ['delete']; return api; },
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        rows.forEach((item, index) => tables[table].push({ id: item.id || `insert-${tables[table].length + index + 1}`, ...clone(item) }));
        return Promise.resolve({ data: clone(rows), error: null });
      },
      then(resolve) {
        if (state.mutation?.[0] === 'update') {
          for (const row of apply()) Object.assign(row, clone(state.mutation[1]));
          return Promise.resolve({ data: clone(apply()), error: null }).then(resolve);
        }
        if (state.mutation?.[0] === 'delete') {
          const doomed = new Set(apply().map((row) => row.id));
          tables[table] = tables[table].filter((row) => !doomed.has(row.id));
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        return Promise.resolve({ data: clone(apply()), error: null }).then(resolve);
      },
    };
    return api;
  }

  return { from: query, tables };
}

test('editing one specialized logical route preserves sibling route rows sharing the same source and destination', async () => {
  const supabase = makeSupabase();
  const response = await handleV1AdminLogicalRoutesRequest(
    jsonRequest({
      sourceConnectionId: 'source-main',
      destinationId: 'dest-mt5',
      previousSourceConnectionId: 'source-main',
      previousDestinationId: 'dest-mt5',
      previousRouteIds: ['route-gold'],
      mode: 'selective',
      selectedFeedIds: ['feed-a'],
      routeName: 'Gold edited',
      priority: 5,
      filters: { allowedCanonicalSymbols: ['XAUUSD'] },
      enabled: true,
    }),
    {},
    { supabaseFactory: async () => supabase, authorizeFn: async () => authorization() },
  );

  assert.equal(response.status, 200);
  const rows = supabase.tables.source_destination_routes;
  const gold = rows.find((row) => row.id === 'route-gold');
  const synthetic = rows.find((row) => row.id === 'route-synthetic');
  assert.equal(gold.route_name, 'Gold edited');
  assert.ok(synthetic, 'sibling specialized route must remain');
  assert.deepEqual(synthetic.filters, { allowedCanonicalSymbols: ['DERIV:VOLATILITY_75'] });
});

test('editing one logical route cannot steal a feed already owned by a sibling logical route', async () => {
  const supabase = makeSupabase();
  const response = await handleV1AdminLogicalRoutesRequest(
    jsonRequest({
      sourceConnectionId: 'source-main', destinationId: 'dest-mt5',
      previousSourceConnectionId: 'source-main', previousDestinationId: 'dest-mt5', previousRouteIds: ['route-gold'],
      mode: 'selective', selectedFeedIds: ['feed-b'], routeName: 'Gold edited', priority: 5, filters: {}, enabled: true,
    }),
    {},
    { supabaseFactory: async () => supabase, authorizeFn: async () => authorization() },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, 'LOGICAL_ROUTE_FEED_CONFLICT');
  assert.equal(supabase.tables.source_destination_routes.length, 2);
});

test('creating a selective route for a pair with an all-channels route requires editing the existing route', async () => {
  const supabase = makeSupabase();
  supabase.tables.source_destination_routes = [{
    id: 'route-default', workspace_id: 'ws-1', source_connection_id: 'source-main', source_feed_id: null,
    destination_id: 'dest-mt5', route_name: 'Main to MT5', priority: 100, is_active: true, filters: {},
  }];
  const response = await handleV1AdminLogicalRoutesRequest(
    jsonRequest({
      sourceConnectionId: 'source-main', destinationId: 'dest-mt5', previousRouteIds: [],
      mode: 'selective', selectedFeedIds: ['feed-a'], routeName: 'Selective', priority: 10, filters: {}, enabled: true,
    }),
    {},
    { supabaseFactory: async () => supabase, authorizeFn: async () => authorization() },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, 'LOGICAL_ROUTE_DEFAULT_EXISTS_EDIT_INSTEAD');
  assert.equal(supabase.tables.source_destination_routes.length, 1);
});