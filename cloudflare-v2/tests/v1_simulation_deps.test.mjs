import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1SimulationDependencies } from '../src/pipeline/v1_simulation_deps.js';

function baseEnv() {
  return {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-secret',
    TRADE_STATE_NAMESPACE: {
      idFromName: (name) => `id:${name}`,
      get: () => ({ fetch: async () => new Response('{}', { status: 404 }) }),
    },
  };
}

function demoFixedAccount({ catalog = [], aliases = {} } = {}) {
  return {
    environment: 'demo',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    provider_config: {
      symbolCatalog: catalog,
      symbolAliases: aliases,
      symbolCatalogUpdatedAt: '2026-09-14T00:00:00.000Z',
    },
  };
}

test('V1 simulation dependencies expose authenticated workspace-scoped matched-group reads for fast-entry completion', async () => {
  const calls = [];
  const group = { id: 'group/fast 1', tradeAccountId: 'acct-1', incomplete: true };
  const stub = {
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers });
      return new Response(JSON.stringify(group), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const env = {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-secret',
    TRADE_STATE_NAMESPACE: {
      idFromName: (name) => `id:${name}`,
      get: () => stub,
    },
  };
  const supabase = { from() { throw new Error('database should not be used for group read'); } };

  const deps = await createV1SimulationDependencies({
    env,
    supabase,
    event: { workspace_hint: 'workspace-1' },
  });

  assert.equal(typeof deps.stateStore.getGroup, 'function');
  assert.deepEqual(await deps.stateStore.getGroup('group/fast 1'), group);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/groups\/group%2Ffast%201$/);
  assert.equal(calls[0].headers['x-mkety-internal-token'], 'internal-secret');
  assert.equal(calls[0].headers['x-mkety-workspace-id'], 'workspace-1');
});

test('fixed-lot DEMO planning derives a bounded lot-only instrument only after destination catalog support is proven', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  const instrument = await deps.instrumentProvider(demoFixedAccount({
    catalog: [{ platformSymbol: 'XAUUSD' }],
  }), { symbol: { canonical: 'XAUUSD' } });

  assert.deepEqual(instrument, {
    canonical: 'XAUUSD',
    platformSymbol: 'XAUUSD',
    minLots: 0.01,
    maxLots: 0.01,
    stepLots: 0.01,
  });
});

test('destination catalog resolves canonical Deriv synthetic against the raw broker symbol before planning', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  const instrument = await deps.instrumentProvider(demoFixedAccount({
    catalog: [
      { platformSymbol: 'Volatility 75 Index' },
      { platformSymbol: 'Volatility 75 (1s) Index' },
    ],
  }), { symbol: { canonical: 'DERIV:VOLATILITY_75' } });

  assert.equal(instrument.canonical, 'DERIV:VOLATILITY_75');
  assert.equal(instrument.platformSymbol, 'Volatility 75 Index');
});

test('planning blocks an instrument that the routed destination account does not advertise', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  await assert.rejects(() => deps.instrumentProvider(demoFixedAccount({
    catalog: [{ platformSymbol: 'XAUUSD' }],
  }), { symbol: { canonical: 'DERIV:VOLATILITY_75' } }), (error) => {
    assert.equal(error.code, 'DESTINATION_SYMBOL_NOT_SUPPORTED');
    assert.match(error.message, /SYMBOL_NOT_FOUND/);
    return true;
  });
});

test('planning fails closed when a routed destination has no authoritative symbol catalog', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  await assert.rejects(() => deps.instrumentProvider(demoFixedAccount(), { symbol: { canonical: 'XAUUSD' } }), (error) => {
    assert.equal(error.code, 'DESTINATION_SYMBOL_CATALOG_UNAVAILABLE');
    return true;
  });
});

test('planning fails closed when destination broker symbol resolution is ambiguous', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  await assert.rejects(() => deps.instrumentProvider(demoFixedAccount({
    catalog: [
      { platformSymbol: 'm.XAUUSD' },
      { platformSymbol: 'XAUUSD.r' },
    ],
  }), { symbol: { canonical: 'XAUUSD' } }), (error) => {
    assert.equal(error.code, 'DESTINATION_SYMBOL_AMBIGUOUS');
    assert.match(error.message, /AMBIGUOUS_SYMBOL/);
    return true;
  });
});

test('LIVE fixed-lot planning derives broker volume constraints from the authoritative destination catalog', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  const instrument = await deps.instrumentProvider({
    environment: 'live',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    provider_config: {
      symbolCatalog: [{
        platformSymbol: 'BTCUSD',
        tradable: true,
        minLots: 0.01,
        maxLots: 500,
        stepLots: 0.01,
        tickSize: 0.01,
        contractSize: 1,
      }],
    },
  }, { symbol: { canonical: 'BTCUSD' } });

  assert.equal(instrument.canonical, 'BTCUSD');
  assert.equal(instrument.platformSymbol, 'BTCUSD');
  assert.equal(instrument.minLots, 0.01);
  assert.equal(instrument.maxLots, 500);
  assert.equal(instrument.stepLots, 0.01);
});

test('LIVE fixed-lot planning still fails closed for symbols absent from the authoritative destination catalog', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  await assert.rejects(() => deps.instrumentProvider({
    environment: 'live',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    provider_config: { symbolCatalog: [{ platformSymbol: 'XAUUSD', tradable: true, minLots: 0.01, maxLots: 100, stepLots: 0.01 }] },
  }, { symbol: { canonical: 'BTCUSD' } }), (error) => {
    assert.equal(error.code, 'DESTINATION_SYMBOL_NOT_SUPPORTED');
    return true;
  });
});

test('routed cTrader account hydrates a missing broker catalog before planning', async () => {
  const account = {
    id: 'acct-ctrader-demo',
    workspace_id: 'workspace-1',
    platform: 'ctrader',
    provider_mode: 'ctrader_oauth',
    environment: 'demo',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    is_active: true,
    provider_config: {},
  };
  const updates = [];
  const supabase = {
    from(table) {
      if (table === 'source_destination_routes') {
        return {
          select() { return this; }, eq() { return this; }, order: async () => ({ data: [{ destination_id: 'dest-1', priority: 1 }], error: null }),
        };
      }
      if (table === 'trading_destinations') {
        return {
          select() { return this; }, eq() { return this; }, in: async () => ({ data: [{ id: 'dest-1', destination_ref: 'acct-ctrader-demo', destination_type: 'broker_account', is_active: true }], error: null }),
        };
      }
      if (table === 'trade_accounts') {
        return {
          select() { return this; },
          eq() { return this; },
          in: async () => ({ data: [account], error: null }),
          update(value) { updates.push(value); return { eq() { return this; }, select: async () => ({ data: null, error: null }) }; },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const hydratedCatalog = [{ platformSymbol: 'XAUUSD', platformId: 41, tradable: true }];
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase,
    sourceId: 'source-1',
    event: { workspace_hint: 'workspace-1' },
    accountCatalogLoader: async (candidate) => {
      assert.equal(candidate.id, 'acct-ctrader-demo');
      return { catalog: hydratedCatalog, aliases: {} };
    },
  });

  const [routed] = await deps.accountProvider();
  const instrument = await deps.instrumentProvider(routed, { symbol: { canonical: 'XAUUSD' } });

  assert.equal(instrument.platformSymbol, 'XAUUSD');
  assert.deepEqual(routed.provider_config.symbolCatalog, hydratedCatalog);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].provider_config.symbolCatalog, hydratedCatalog);
});


test('real broker planning ignores static simulation price fixtures so they cannot suppress valid TP legs', async () => {
  const deps = await createV1SimulationDependencies({
    env: {
      ...baseEnv(),
      TRADING_V1_SIMULATION_PRICES: JSON.stringify({ XAUUSD: 2500 }),
    },
    supabase: { from() { throw new Error('database should not be used for price fixture test'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  assert.equal(await deps.marketPriceProvider({}, { symbol: { canonical: 'XAUUSD' } }), undefined);
});

test('explicit simulation mode still uses configured simulation price fixtures', async () => {
  const deps = await createV1SimulationDependencies({
    env: {
      ...baseEnv(),
      TRADING_V1_SIMULATION: 'true',
      TRADING_V1_SIMULATION_PRICES: JSON.stringify({ XAUUSD: 2500 }),
    },
    supabase: { from() { throw new Error('database should not be used for price fixture test'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  assert.equal(await deps.marketPriceProvider({}, { symbol: { canonical: 'XAUUSD' } }), 2500);
});
