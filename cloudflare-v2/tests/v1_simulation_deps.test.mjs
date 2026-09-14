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

test('V1 simulation dependencies expose authenticated matched-group reads for fast-entry completion', async () => {
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

test('missing cTrader OAuth catalog is repaired from broker metadata before symbol routing', async () => {
  let refreshCalls = 0;
  const account = {
    id: 'ctrader-demo-1',
    account_id: '48685071',
    platform: 'ctrader',
    provider_mode: 'ctrader_oauth',
    environment: 'demo',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    provider_config: {},
  };
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used when refresher is injected'); } },
    event: { workspace_hint: 'workspace-1' },
    symbolCatalogRefresher: async (candidate) => {
      refreshCalls += 1;
      assert.equal(candidate.id, account.id);
      return {
        catalog: [
          { platformSymbol: 'XAU/USD' },
          { platformSymbol: 'Volatility 75 (1s) Index' },
        ],
        aliases: {},
      };
    },
  });

  const gold = await deps.instrumentProvider(account, { symbol: { canonical: 'XAUUSD' } });
  const synthetic = await deps.instrumentProvider(account, { symbol: { canonical: 'DERIV:VOLATILITY_75_1S' } });

  assert.equal(refreshCalls, 1);
  assert.equal(gold.platformSymbol, 'XAU/USD');
  assert.equal(synthetic.platformSymbol, 'Volatility 75 (1s) Index');
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

test('LIVE planning still fails closed when broker instrument metadata is absent', async () => {
  const deps = await createV1SimulationDependencies({
    env: baseEnv(),
    supabase: { from() { throw new Error('database should not be used for instrument fallback'); } },
    event: { workspace_hint: 'workspace-1' },
  });

  await assert.rejects(() => deps.instrumentProvider({
    environment: 'live',
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    provider_config: { symbolCatalog: [{ platformSymbol: 'XAUUSD' }] },
  }, { symbol: { canonical: 'XAUUSD' } }), /simulation instrument metadata is not configured for XAUUSD/);
});
