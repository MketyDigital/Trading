import assert from 'node:assert/strict';
import test from 'node:test';
import { createV1SimulationDependencies } from '../src/pipeline/v1_simulation_deps.js';

function env() {
  return {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-secret',
    TRADE_STATE_NAMESPACE: {
      idFromName: (name) => `id:${name}`,
      get: () => ({ fetch: async () => new Response('{}', { status: 404 }) }),
    },
  };
}

function account(id, platform = 'ctrader') {
  return {
    id,
    workspace_id: 'ws-1',
    platform,
    environment: 'demo',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    is_active: true,
    provider_config: { symbolCatalog: [{ platformSymbol: 'XAUUSD' }, { platformSymbol: 'Volatility 75 Index', canonicalSymbol: 'DERIV:VOLATILITY_75' }] },
  };
}

function supabaseFor({ routes, feed, destinations, accounts }) {
  return {
    from(table) {
      if (table === 'source_destination_routes') {
        return {
          select() { return this; },
          eq() { return this; },
          order: async () => ({ data: routes, error: null }),
        };
      }
      if (table === 'source_feeds') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: feed, error: null }),
        };
      }
      if (table === 'trading_destinations') {
        return {
          select() { return this; },
          eq() { return this; },
          in: async (_field, ids) => ({ data: destinations.filter((row) => ids.includes(row.id)), error: null }),
        };
      }
      if (table === 'trade_accounts') {
        return {
          select() { return this; },
          eq() { return this; },
          in: async (_field, ids) => ({ data: accounts.filter((row) => ids.includes(row.id)), error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const telegramEvent = {
  workspace_hint: 'ws-1',
  metadata: { native_identity: { chat_id: '-100200' } },
};

test('feed-selective routing for one destination does not suppress an unrelated all-channels destination', async () => {
  const supabase = supabaseFor({
    routes: [
      { destination_id: 'dest-default', priority: 1, source_feed_id: null, filters: {} },
      { destination_id: 'dest-feed', priority: 2, source_feed_id: 'feed-1', filters: {} },
    ],
    feed: { id: 'feed-1' },
    destinations: [
      { id: 'dest-default', destination_ref: 'acct-default', destination_type: 'broker_account', is_active: true },
      { id: 'dest-feed', destination_ref: 'acct-feed', destination_type: 'broker_account', is_active: true },
    ],
    accounts: [account('acct-default', 'mt5'), account('acct-feed')],
  });

  const deps = await createV1SimulationDependencies({
    env: env(), supabase, sourceId: 'source-1', event: telegramEvent,
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' } } },
  });

  const routed = await deps.accountProvider();
  assert.deepEqual(routed.map((row) => row.id), ['acct-default', 'acct-feed']);
});

test('unselected feed cannot inherit legacy default for the same selective destination', async () => {
  const supabase = supabaseFor({
    routes: [
      { destination_id: 'dest-selective', priority: 1, source_feed_id: null, filters: {} },
      { destination_id: 'dest-selective', priority: 2, source_feed_id: 'feed-2', filters: {} },
      { destination_id: 'dest-other', priority: 3, source_feed_id: null, filters: {} },
    ],
    feed: { id: 'feed-1' },
    destinations: [
      { id: 'dest-selective', destination_ref: 'acct-selective', destination_type: 'broker_account', is_active: true },
      { id: 'dest-other', destination_ref: 'acct-other', destination_type: 'broker_account', is_active: true },
    ],
    accounts: [account('acct-selective', 'mt5'), account('acct-other')],
  });

  const deps = await createV1SimulationDependencies({
    env: env(), supabase, sourceId: 'source-1', event: telegramEvent,
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' } } },
  });

  const routed = await deps.accountProvider();
  assert.deepEqual(routed.map((row) => row.id), ['acct-other']);
});

test('broker planning applies feed route canonical-symbol filters before accounts enter planning', async () => {
  const supabase = supabaseFor({
    routes: [
      { destination_id: 'dest-gold', priority: 1, source_feed_id: 'feed-1', filters: { allowedCanonicalSymbols: ['XAUUSD'] } },
      { destination_id: 'dest-volatility', priority: 2, source_feed_id: 'feed-1', filters: { allowedCanonicalSymbols: ['DERIV:VOLATILITY_75'] } },
    ],
    feed: { id: 'feed-1' },
    destinations: [
      { id: 'dest-gold', destination_ref: 'acct-mt5', destination_type: 'broker_account', is_active: true },
      { id: 'dest-volatility', destination_ref: 'acct-ctrader', destination_type: 'broker_account', is_active: true },
    ],
    accounts: [account('acct-mt5', 'mt5'), account('acct-ctrader')],
  });

  const deps = await createV1SimulationDependencies({
    env: env(), supabase, sourceId: 'source-1', event: telegramEvent,
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'DERIV:VOLATILITY_75' } } },
  });

  const routed = await deps.accountProvider();
  assert.deepEqual(routed.map((row) => row.id), ['acct-ctrader']);
});
