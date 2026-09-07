import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMT5DemoEnvironment,
  probeMT5Demo,
  buildMT5DemoMarketAction,
  runMT5DemoOrderLifecycle,
} from '../src/testing/mt5_demo_acceptance.js';

test('MT5 demo environment reports missing names only and requires expected demo server', () => {
  const result = validateMT5DemoEnvironment({
    MT5_BRIDGE_URL: 'https://bridge-secret-host.example',
    MT5_BRIDGE_SECRET: 'bridge-secret-never-print',
    MT5_ACCOUNT_ID: '1001',
    MT5_DEMO_SERVER: '',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['MT5_DEMO_SERVER']);
  assert.doesNotMatch(JSON.stringify(result), /bridge-secret-host|bridge-secret-never-print/i);
});

test('MT5 demo probe validates health/account/server, resolves broker symbol dynamically and captures live tick', async () => {
  const calls = [];
  const responses = new Map([
    ['/health', { ok: true }],
    ['/v1/account', { ok: true, account: { login: 1001, server: 'Broker-Demo-01', trade_allowed: true, trade_expert: true, balance: 10000, equity: 10000 } }],
    ['/v1/symbols', { ok: true, symbols: [
      { name: 'EURUSD.pro', description: 'Euro vs US Dollar', digits: 5, trade_tick_size: 0.00001, trade_contract_size: 100000, volume_min: 0.01, volume_max: 50, volume_step: 0.01 },
      { name: 'XAUUSD.a', description: 'Gold Spot', digits: 2, trade_tick_size: 0.01, trade_contract_size: 100, volume_min: 0.01, volume_max: 100, volume_step: 0.01 },
    ] }],
    ['/v1/tick?symbol=XAUUSD.a', { ok: true, tick: { bid: 2525.9, ask: 2526.1, time_msc: 1725180000000 } }],
  ]);

  const result = await probeMT5Demo({
    env: {
      MT5_BRIDGE_URL: 'https://bridge.example/',
      MT5_BRIDGE_SECRET: 'secret-not-used-for-probe',
      MT5_ACCOUNT_ID: '1001',
      MT5_DEMO_SERVER: 'Broker-Demo-01',
      MT5_DEMO_SYMBOL: 'GOLD',
    },
    fetchFn: async (url) => {
      const parsed = new URL(url);
      const key = `${parsed.pathname}${parsed.search}`;
      calls.push(key);
      const data = responses.get(key);
      return { ok: Boolean(data), status: data ? 200 : 404, json: async () => data || { ok: false } };
    },
  });

  assert.deepEqual(calls, ['/health', '/v1/account', '/v1/symbols', '/v1/tick?symbol=XAUUSD.a']);
  assert.equal(result.ready, true);
  assert.equal(result.environment, 'demo');
  assert.equal(result.account.login, '1001');
  assert.equal(result.account.server, 'Broker-Demo-01');
  assert.equal(result.symbol.canonical, 'XAUUSD');
  assert.equal(result.symbol.platformSymbol, 'XAUUSD.a');
  assert.equal(result.symbol.minLots, 0.01);
  assert.equal(result.quote.bid, 2525.9);
  assert.equal(result.quote.ask, 2526.1);
  assert.doesNotMatch(JSON.stringify(result), /secret-not-used-for-probe/i);
});

test('MT5 demo probe fails closed on account or server mismatch before symbol/tick discovery', async () => {
  const calls = [];
  await assert.rejects(() => probeMT5Demo({
    env: {
      MT5_BRIDGE_URL: 'https://bridge.example',
      MT5_BRIDGE_SECRET: 'secret',
      MT5_ACCOUNT_ID: '1001',
      MT5_DEMO_SERVER: 'Expected-Demo',
    },
    fetchFn: async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === '/health') return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (path === '/v1/account') return { ok: true, status: 200, json: async () => ({ ok: true, account: { login: 1001, server: 'Wrong-Live-Server', trade_allowed: true } }) };
      throw new Error('should not fetch symbols');
    },
  }), /demo server mismatch/i);

  assert.deepEqual(calls, ['/health', '/v1/account']);
});

test('MT5 demo market action requires explicit order gate and refuses lots below broker minimum', () => {
  const symbol = {
    canonical: 'XAUUSD', platformSymbol: 'XAUUSD.a', digits: 2, tickSize: 0.01,
    minLots: 0.01, maxLots: 100, stepLots: 0.01,
  };

  assert.throws(() => buildMT5DemoMarketAction({
    env: { MT5_DEMO_ORDER_TEST: 'false', MT5_DEMO_TEST_LOTS: '0.01' },
    symbol, quote: { bid: 2525.9, ask: 2526.1 }, side: 'BUY', runId: 'run-1',
  }), /explicitly enabled/i);

  assert.throws(() => buildMT5DemoMarketAction({
    env: { MT5_DEMO_ORDER_TEST: 'true', MT5_DEMO_TEST_LOTS: '0.001' },
    symbol, quote: { bid: 2525.9, ask: 2526.1 }, side: 'BUY', runId: 'run-1',
  }), /below broker minimum/i);
});

test('MT5 demo lifecycle opens protected trade, moves BE to actual fill, partial closes and closes exact remainder', async () => {
  const actions = [];
  const probe = {
    ready: true,
    environment: 'demo',
    account: { login: '1001', server: 'Broker-Demo-01', tradeAllowed: true },
    symbol: { canonical: 'XAUUSD', platformSymbol: 'XAUUSD.a', digits: 2, tickSize: 0.01, minLots: 0.01, maxLots: 100, stepLots: 0.01 },
    quote: { bid: 2525.9, ask: 2526.1 },
  };

  const result = await runMT5DemoOrderLifecycle({
    env: {
      MT5_BRIDGE_URL: 'https://bridge.example', MT5_BRIDGE_SECRET: 'secret', MT5_ACCOUNT_ID: '1001',
      MT5_DEMO_SERVER: 'Broker-Demo-01', MT5_DEMO_ORDER_TEST: 'true', MT5_DEMO_TEST_LOTS: '0.02',
      MT5_DEMO_STOP_TICKS: '100', MT5_DEMO_TARGET_TICKS: '150', TRADING_WORKSPACE_ID: 'workspace-1',
    },
    deliveryStore: {},
    probeFn: async () => probe,
    executor: async (action) => {
      actions.push(action);
      if (action.type === 'OPEN_POSITION') return { brokerPositionId: '9001', fillPrice: 2526.15 };
      return { brokerPositionId: '9001' };
    },
    runId: 'life-1',
  });

  assert.equal(result.environment, 'demo');
  assert.equal(result.positionId, '9001');
  assert.equal(result.fillPrice, 2526.15);
  assert.equal(result.partialClosedLots, 0.01);
  assert.equal(result.finalClosedLots, 0.01);
  assert.deepEqual(actions.map((action) => action.type), ['OPEN_POSITION', 'MODIFY_POSITION', 'CLOSE_PARTIAL', 'CLOSE_POSITION']);
  assert.equal(actions[1].stopLoss, 2526.15);
  assert.equal(actions[2].lots, 0.01);
  assert.equal(actions[3].lots, 0.01);
  assert.match(actions[0].idempotencyKey, /life-1:open$/);
});

test('MT5 demo lifecycle is impossible without explicit order gate', async () => {
  let executorCalls = 0;
  await assert.rejects(() => runMT5DemoOrderLifecycle({
    env: {
      MT5_BRIDGE_URL: 'https://bridge.example', MT5_BRIDGE_SECRET: 'secret', MT5_ACCOUNT_ID: '1001',
      MT5_DEMO_SERVER: 'Broker-Demo-01', MT5_DEMO_ORDER_TEST: 'false', MT5_DEMO_TEST_LOTS: '0.02',
      TRADING_WORKSPACE_ID: 'workspace-1',
    },
    deliveryStore: {},
    probeFn: async () => ({
      ready: true, environment: 'demo', account: { login: '1001', server: 'Broker-Demo-01' },
      symbol: { canonical: 'XAUUSD', platformSymbol: 'XAUUSD.a', digits: 2, tickSize: 0.01, minLots: 0.01, maxLots: 100, stepLots: 0.01 },
      quote: { bid: 2525.9, ask: 2526.1 },
    }),
    executor: async () => { executorCalls += 1; },
  }), /explicitly enabled/i);
  assert.equal(executorCalls, 0);
});
