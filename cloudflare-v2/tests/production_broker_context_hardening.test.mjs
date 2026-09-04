import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function supabaseStub() {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; },
      };
    },
  };
}

function mt5Account(overrides = {}) {
  return {
    id: 'acct-row-a',
    workspace_id: 'ws-a',
    platform: 'mt5',
    account_id: '90001',
    server_name: 'Broker-Demo',
    sizingMode: 'RISK_PERCENT',
    riskPercent: 1,
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false, maxRiskPercent: 2 },
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    type: 'OPEN_POSITION',
    side: 'BUY',
    orderType: 'MARKET',
    symbol: 'XAUUSD',
    entry: { kind: 'PRICE', value: 2500 },
    lots: 0.1,
    stopLoss: 2490,
    takeProfit: 2510,
    idempotencyKey: 'event-1:acct-row-a:leg-1',
    ...overrides,
  };
}

function context() {
  return {
    commandUrl: 'https://bridge.example/v1/command',
    brokerAccount: { equity: 10000, balance: 10000 },
    catalog: [{
      canonical: 'XAUUSD',
      platform: 'mt5',
      platformSymbol: 'XAUUSD',
      tickSize: 0.01,
      tickValuePerLot: 1,
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.01,
    }],
    async marketPriceFor() { return 2500; },
  };
}

test('default MT5 metadata requests authenticate sensitive GETs with server-owned bridge secret', async () => {
  const requests = [];
  const fetchFn = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path.endsWith('/health')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/v1/account') {
      return new Response(JSON.stringify({ ok: true, account: { login: 90001, server: 'Broker-Demo' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (path === '/v1/symbols') {
      return new Response(JSON.stringify({ ok: true, symbols: [{ name: 'XAUUSD', digits: 2, trade_tick_size: 0.01, trade_tick_value: 1, volume_min: 0.01, volume_max: 100, volume_step: 0.01 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected request ${url}`);
  };

  const deps = createProductionExecutionDependencies({
    env: {
      MT5_BRIDGE_URL: 'https://bridge.example',
      MT5_BRIDGE_SECRET: 'server-bridge-secret',
    },
    supabase: supabaseStub(),
    workspaceId: 'ws-a',
    tradingEventId: 'event-1',
  }, {
    fetchFn,
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    mt5Executor: async () => ({ ok: true }),
  });

  await deps.dispatchAction({ workspaceId: 'ws-a', account: mt5Account({ sizingMode: 'FIXED_LOTS' }), action: action() });

  const sensitive = requests.filter(({ url }) => ['/v1/account', '/v1/symbols'].includes(new URL(url).pathname));
  assert.equal(sensitive.length, 2);
  for (const { options } of sensitive) {
    const headers = new Headers(options.headers);
    assert.ok(headers.get('X-Mkety-Timestamp'));
    assert.match(headers.get('X-Mkety-Signature') || '', /^v1=[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(options).includes('server-bridge-secret'), false);
  }
});

test('one MT5 risk-sized action reuses only its freshly loaded broker context between risk validation and dispatch', async () => {
  let contextLoads = 0;
  const row = mt5Account();
  const canonicalAction = action();
  const deps = createProductionExecutionDependencies({
    env: {
      MT5_BRIDGE_URL: 'https://bridge.example',
      MT5_BRIDGE_SECRET: 'server-bridge-secret',
    },
    supabase: supabaseStub(),
    workspaceId: 'ws-a',
    tradingEventId: 'event-1',
  }, {
    mt5ContextLoader: async () => {
      contextLoads += 1;
      return context();
    },
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    mt5Executor: async () => ({ ok: true }),
  });

  const materialized = await deps.riskMaterializer({ workspaceId: 'ws-a', account: row, action: canonicalAction });
  await deps.dispatchAction({ workspaceId: 'ws-a', account: row, action: materialized.action });

  assert.equal(contextLoads, 1, 'same action should share one freshly loaded MT5 broker context');

  await deps.riskMaterializer({ workspaceId: 'ws-a', account: row, action: action({ idempotencyKey: 'event-1:acct-row-a:leg-2' }) });
  assert.equal(contextLoads, 2, 'a different action must obtain fresh broker authority');
});
