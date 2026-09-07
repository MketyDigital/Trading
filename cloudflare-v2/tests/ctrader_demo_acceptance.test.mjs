import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCTraderDemoEnvironment,
  probeCTraderDemo,
  buildCTraderDemoMarketAction,
  runCTraderDemoOrderLifecycle,
} from '../src/testing/ctrader_demo_acceptance.js';

test('cTrader demo environment validation reports names only and ignores any live-mode request', () => {
  const env = {
    CTRADER_CLIENT_ID: 'client-secret-ish-id',
    CTRADER_CLIENT_SECRET: 'do-not-print-client-secret',
    CTRADER_ACCESS_TOKEN: 'do-not-print-access-token',
    CTRADER_ACCOUNT_ID: '77',
    CTRADER_ENVIRONMENT: 'live',
  };
  const result = validateCTraderDemoEnvironment(env);
  assert.equal(result.ok, true);
  assert.equal(result.environment, 'demo');
  assert.doesNotMatch(JSON.stringify(result), /do-not-print|access-token|client-secret/i);
});

test('demo probe authenticates only demo runtime, resolves broker symbol and captures first spot quote', async () => {
  let runtimeOptions;
  let subscribedIds;
  const runtime = {
    environment: 'demo',
    account: { accountType: 'HEDGED', accessRights: 'FULL_ACCESS', canOpenTrades: true },
    catalog: [{
      platform: 'ctrader', platformId: 41, platformSymbol: 'XAU/USD', canonical: 'XAUUSD', aliases: ['GOLD'],
      digits: 2, tickSize: 0.01, pipSize: 0.1, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100,
    }],
    marketData: {
      subscribeQuotes: async (ids) => { subscribedIds = ids; },
      handleSpotEvent: () => ({ bid: 2500.1, ask: 2500.2, timestamp: 1725180000000 }),
      quoteFor: () => ({ bid: 2500.1, ask: 2500.2, timestamp: 1725180000000 }),
    },
    session: {
      waitForEvent: async (predicate) => {
        const event = { payloadType: 2131, payload: { symbolId: 41, bid: 250010000, ask: 250020000 } };
        assert.equal(predicate(event), true);
        return event;
      },
    },
    close() {},
  };
  const result = await probeCTraderDemo({
    env: {
      CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 'secret', CTRADER_ACCESS_TOKEN: 'token', CTRADER_ACCOUNT_ID: '77',
      CTRADER_DEMO_SYMBOL: 'GOLD',
    },
    deliveryStore: { reserve() {}, complete() {}, fail() {} },
    runtimeFactory: async (options) => { runtimeOptions = options; return runtime; },
  });

  assert.equal(runtimeOptions.environment, 'demo');
  assert.equal(runtimeOptions.allowLiveTrading, false);
  assert.deepEqual(subscribedIds, [41]);
  assert.equal(result.ready, true);
  assert.equal(result.symbol.canonical, 'XAUUSD');
  assert.equal(result.symbol.platformSymbol, 'XAU/USD');
  assert.equal(result.quote.bid, 2500.1);
  assert.equal(result.quote.ask, 2500.2);
  assert.equal(result.account.accountType, 'HEDGED');
  assert.equal(result.account.accessRights, 'FULL_ACCESS');
  assert.doesNotMatch(JSON.stringify(result), /secret|token/i);
});

test('cTrader probe supplies a fail-closed execution store when no persistent store is configured', async () => {
  let runtimeOptions;
  const runtime = {
    environment: 'demo',
    account: { accountType: 'HEDGED', accessRights: 'FULL_ACCESS', canOpenTrades: true },
    catalog: [{
      platform: 'ctrader', platformId: 41, platformSymbol: 'XAU/USD', canonical: 'XAUUSD', aliases: ['GOLD'],
      digits: 2, tickSize: 0.01, pipSize: 0.1, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100,
    }],
    marketData: {
      subscribeQuotes: async () => {},
      handleSpotEvent: () => {},
      quoteFor: () => ({ bid: 2500.1, ask: 2500.2, timestamp: 1725180000000 }),
    },
    session: { waitForEvent: async () => ({ payloadType: 2131, payload: { symbolId: 41 } }) },
    close() {},
  };

  const result = await probeCTraderDemo({
    env: {
      CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 'secret', CTRADER_ACCESS_TOKEN: 'token', CTRADER_ACCOUNT_ID: '77',
      CTRADER_DEMO_SYMBOL: 'GOLD',
    },
    runtimeFactory: async (options) => { runtimeOptions = options; return runtime; },
  });

  assert.equal(result.ready, true);
  assert.equal(runtimeOptions.environment, 'demo');
  assert.equal(runtimeOptions.allowLiveTrading, false);
  assert.equal(typeof runtimeOptions.deliveryStore?.reserve, 'function');
  assert.equal(typeof runtimeOptions.deliveryStore?.complete, 'function');
  assert.equal(typeof runtimeOptions.deliveryStore?.fail, 'function');
  assert.throws(() => runtimeOptions.deliveryStore.reserve(), /probe.*execution.*disabled/i);
  assert.throws(() => runtimeOptions.deliveryStore.complete(), /probe.*execution.*disabled/i);
  assert.throws(() => runtimeOptions.deliveryStore.fail(), /probe.*execution.*disabled/i);
});

test('demo market action requires explicit order-test gate and refuses lots below broker minimum', () => {
  const symbol = {
    canonical: 'XAUUSD', platformSymbol: 'XAU/USD', platformId: 41,
    digits: 2, tickSize: 0.01, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100,
  };
  assert.throws(() => buildCTraderDemoMarketAction({
    env: { CTRADER_DEMO_ORDER_TEST: 'false', CTRADER_DEMO_TEST_LOTS: '0.01' },
    symbol, quote: { bid: 2500.1, ask: 2500.2 }, side: 'BUY', runId: 'run-1',
  }), /explicitly enabled/i);

  assert.throws(() => buildCTraderDemoMarketAction({
    env: { CTRADER_DEMO_ORDER_TEST: 'true', CTRADER_DEMO_TEST_LOTS: '0.001' },
    symbol, quote: { bid: 2500.1, ask: 2500.2 }, side: 'BUY', runId: 'run-1',
  }), /below broker minimum/i);
});

test('demo market action creates bounded protected MARKET action from live quote and broker tick size', () => {
  const action = buildCTraderDemoMarketAction({
    env: {
      CTRADER_DEMO_ORDER_TEST: 'true',
      CTRADER_DEMO_TEST_LOTS: '0.01',
      CTRADER_DEMO_STOP_TICKS: '100',
      CTRADER_DEMO_TARGET_TICKS: '150',
    },
    symbol: {
      canonical: 'XAUUSD', platformSymbol: 'XAU/USD', platformId: 41,
      digits: 2, tickSize: 0.01, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100,
    },
    quote: { bid: 2500.1, ask: 2500.2 },
    side: 'BUY',
    runId: 'run-42',
  });

  assert.deepEqual(action, {
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', entry: { kind: 'MARKET' },
    lots: 0.01, stopLoss: 2499.2, takeProfit: 2501.7, idempotencyKey: 'ctrader-demo:run-42:open',
  });
});

test('demo lifecycle opens protected trade, moves BE to actual fill, partial closes and closes exact remainder', async () => {
  const executed = [];
  let closed = false;
  let runtimeOptions;
  const symbol = {
    platform: 'ctrader', platformId: 41, platformSymbol: 'XAU/USD', canonical: 'XAUUSD', aliases: ['GOLD'],
    digits: 2, tickSize: 0.01, pipSize: 0.1, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100,
  };
  const runtime = {
    environment: 'demo',
    account: { accountType: 'HEDGED', accessRights: 'FULL_ACCESS', canOpenTrades: true },
    catalog: [symbol],
    marketData: {
      subscribeQuotes: async () => {},
      handleSpotEvent: () => {},
      quoteFor: () => ({ bid: 2500.1, ask: 2500.2, timestamp: 1725180000000 }),
    },
    session: {
      waitForEvent: async (predicate) => {
        const event = { payloadType: 2131, payload: { symbolId: 41, bid: 250010000, ask: 250020000 } };
        assert.equal(predicate(event), true);
        return event;
      },
    },
    execute: async (action) => {
      executed.push(structuredClone(action));
      if (action.type === 'OPEN_POSITION') {
        return { brokerPositionId: 456, brokerOrderId: 1001, fillPrice: 2500.25 };
      }
      return { brokerPositionId: 456 };
    },
    close() { closed = true; },
  };

  const result = await runCTraderDemoOrderLifecycle({
    env: {
      CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 'secret', CTRADER_ACCESS_TOKEN: 'token', CTRADER_ACCOUNT_ID: '77',
      CTRADER_DEMO_ORDER_TEST: 'true', CTRADER_DEMO_SYMBOL: 'GOLD', CTRADER_DEMO_TEST_LOTS: '0.02',
      CTRADER_DEMO_STOP_TICKS: '100', CTRADER_DEMO_TARGET_TICKS: '150',
    },
    deliveryStore: { reserve() {}, complete() {}, fail() {} },
    runtimeFactory: async (options) => { runtimeOptions = options; return runtime; },
    runId: 'run-42',
  });

  assert.equal(runtimeOptions.environment, 'demo');
  assert.equal(runtimeOptions.allowLiveTrading, false);
  assert.equal(closed, true);
  assert.deepEqual(executed, [
    {
      type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', entry: { kind: 'MARKET' },
      lots: 0.02, stopLoss: 2499.2, takeProfit: 2501.7, idempotencyKey: 'ctrader-demo:run-42:open',
    },
    {
      type: 'MODIFY_POSITION', brokerPositionId: 456, symbol: 'XAUUSD', stopLoss: 2500.25,
      idempotencyKey: 'ctrader-demo:run-42:be',
    },
    {
      type: 'CLOSE_PARTIAL', brokerPositionId: 456, symbol: 'XAUUSD', lots: 0.01,
      idempotencyKey: 'ctrader-demo:run-42:partial',
    },
    {
      type: 'CLOSE_POSITION', brokerPositionId: 456, symbol: 'XAUUSD', lots: 0.01,
      idempotencyKey: 'ctrader-demo:run-42:close',
    },
  ]);
  assert.deepEqual(result, {
    ready: true,
    environment: 'demo',
    symbol: 'XAUUSD',
    brokerPositionId: 456,
    brokerOrderId: 1001,
    fillPrice: 2500.25,
    requestedLots: 0.02,
    partialClosedLots: 0.01,
    finalClosedLots: 0.01,
    steps: ['OPEN_POSITION', 'MOVE_TO_BE', 'CLOSE_PARTIAL', 'CLOSE_POSITION'],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|token/i);
});

test('demo lifecycle is impossible without explicit order gate and always closes runtime after post-open failure', async () => {
  await assert.rejects(() => runCTraderDemoOrderLifecycle({
    env: {
      CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 'secret', CTRADER_ACCESS_TOKEN: 'token', CTRADER_ACCOUNT_ID: '77',
      CTRADER_DEMO_ORDER_TEST: 'false', CTRADER_DEMO_TEST_LOTS: '0.02',
    },
    deliveryStore: { reserve() {}, complete() {}, fail() {} },
    runtimeFactory: async () => { throw new Error('runtime must not be created'); },
  }), /explicitly enabled/i);

  let closed = false;
  const runtime = {
    environment: 'demo',
    account: { accountType: 'HEDGED', accessRights: 'FULL_ACCESS', canOpenTrades: true },
    catalog: [{
      platform: 'ctrader', platformId: 41, platformSymbol: 'XAU/USD', canonical: 'XAUUSD',
      digits: 2, tickSize: 0.01, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100,
    }],
    marketData: { subscribeQuotes: async () => {}, handleSpotEvent: () => {}, quoteFor: () => ({ bid: 2500.1, ask: 2500.2 }) },
    session: { waitForEvent: async () => ({ payloadType: 2131, payload: { symbolId: 41 } }) },
    execute: async (action) => {
      if (action.type === 'OPEN_POSITION') return { brokerPositionId: 456, brokerOrderId: 1001, fillPrice: 2500.25 };
      throw new Error('management failed');
    },
    close() { closed = true; },
  };
  await assert.rejects(() => runCTraderDemoOrderLifecycle({
    env: {
      CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 'secret', CTRADER_ACCESS_TOKEN: 'token', CTRADER_ACCOUNT_ID: '77',
      CTRADER_DEMO_ORDER_TEST: 'true', CTRADER_DEMO_TEST_LOTS: '0.02',
    },
    deliveryStore: { reserve() {}, complete() {}, fail() {} },
    runtimeFactory: async () => runtime,
    runId: 'failure-run',
  }), /management failed/i);
  assert.equal(closed, true);
});
