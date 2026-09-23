import test from 'node:test';
import assert from 'node:assert/strict';

import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';
import { executeMt5ConnectorAction } from '../src/adapters/mt5_connector_executor_v2.js';

const now = 1_700_000_000_000;

function group(overrides = {}) {
  return {
    id: 'g1',
    workspaceId: 'ws1',
    tradeAccountId: 'acct-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['telegram:-1001:100'],
    threadId: null,
    symbol: 'XAUUSD',
    side: 'BUY',
    status: 'OPEN',
    incomplete: true,
    createdAt: now - 20_000,
    updatedAt: now - 20_000,
    ...overrides,
  };
}

test('near-identical fast-entry aliases do not open a second logical trade', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:101',
      thread: {},
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'XAUUSD' },
        side: 'BUY',
        orderType: 'MARKET',
        entry: { kind: 'MARKET' },
        fastEntry: true,
        incomplete: true,
      },
    },
    activeGroups: [
      group({ id: 'g-ctrader', tradeAccountId: 'ctrader', sourceEventIds: ['telegram:-1001:100'] }),
      group({ id: 'g-mt5', tradeAccountId: 'mt5', sourceEventIds: ['telegram:-1001:100'] }),
    ],
    nowMs: now,
    correlationWindowMs: 120_000,
  });

  assert.deepEqual(result, {
    status: 'NO_ACTION',
    reason: 'RECENT_FAST_ENTRY_DUPLICATE',
    groupIds: ['g-ctrader', 'g-mt5'],
  });
});

test('a full signal still completes a recent fast entry instead of being suppressed', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:102',
      thread: {},
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'XAUUSD' },
        side: 'BUY',
        orderType: 'MARKET',
        entry: { kind: 'RANGE', min: 4320, max: 4330 },
        stopLoss: 4310,
        takeProfits: [4340, 4350],
        fastEntry: false,
        incomplete: false,
      },
    },
    activeGroups: [group()],
    nowMs: now,
    correlationWindowMs: 120_000,
  });

  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g1' });
});

test('bare management fails closed instead of guessing the newest trade when multiple logical trades are open', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:202',
      thread: {},
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [
      group({ id: 'gold', sourceEventIds: ['telegram:-1001:100'], symbol: 'XAUUSD', updatedAt: now - 90_000 }),
      group({ id: 'v75', sourceEventIds: ['telegram:-1001:200'], symbol: 'DERIV:VOLATILITY_75_1S', updatedAt: now - 10_000 }),
    ],
    nowMs: now,
    correlationWindowMs: 120_000,
  });

  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' });
});

test('bare management remains fail-closed when two distinct trades are equally recent', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: 'telegram:-1001:203', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [
      group({ id: 'gold', sourceEventIds: ['telegram:-1001:100'], symbol: 'XAUUSD', updatedAt: now - 10_000 }),
      group({ id: 'btc', sourceEventIds: ['telegram:-1001:101'], symbol: 'BTCUSD', updatedAt: now - 10_000 }),
    ],
    nowMs: now,
    correlationWindowMs: 120_000,
  });

  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' });
});

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

test('MT5 connector terminal rejection persists the broker reason/body for diagnosis', async () => {
  const failures = [];
  const deliveryStore = {
    async reserve() { return { ok: true, duplicate: false }; },
    async complete() {},
    async fail(_key, failure) { failures.push(failure); },
  };
  let call = 0;
  const fetchFn = async (_url, options = {}) => {
    call += 1;
    if (!options.method || options.method === 'GET') {
      return response({
        online: true,
        accountRowId: 'acct-1',
        identity: {
          accountNumber: '50123456',
          serverName: 'Broker-Demo',
          isLive: false,
          symbols: [{ platformSymbol: 'XAUUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 }],
        },
      });
    }
    return response({ ok: false, reason: 'order_check failed: retcode=10027 AutoTrading disabled by client' }, { ok: false, status: 409 });
  };

  await assert.rejects(
    executeMt5ConnectorAction({
      type: 'OPEN_POSITION',
      symbol: 'XAUUSD',
      side: 'BUY',
      orderType: 'MARKET',
      entry: { kind: 'MARKET' },
      lots: 0.01,
      idempotencyKey: 'event-1:acct-1:leg:1',
    }, {
      workspaceId: 'ws1',
      accountRowId: 'acct-1',
      gatewayUrl: 'https://gateway.example',
      controlSecret: 'secret',
      expectedBrokerAccountId: '50123456',
      expectedServerName: 'Broker-Demo',
      expectedEnvironment: 'demo',
      symbolCatalog: [{ platformSymbol: 'XAUUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 }],
      deliveryStore,
      fetchFn,
    }),
    (error) => error?.code === 'MT5_CONNECTOR_REJECTED',
  );

  assert.equal(call, 2);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].error, 'order_check failed: retcode=10027 AutoTrading disabled by client');
  assert.deepEqual(failures[0].result, {
    ok: false,
    reason: 'order_check failed: retcode=10027 AutoTrading disabled by client',
  });
});


test('MT5 connector treats broker retcode 10025 No changes as idempotent success for modify actions', async () => {
  const completed = [];
  const failures = [];
  const deliveryStore = {
    async reserve() { return { ok: true, duplicate: false }; },
    async complete(_key, result) { completed.push(result); },
    async fail(_key, failure) { failures.push(failure); },
  };
  let call = 0;
  const fetchFn = async (_url, options = {}) => {
    call += 1;
    if (!options.method || options.method === 'GET') {
      return response({
        online: true,
        accountRowId: 'acct-1',
        identity: {
          accountNumber: '50123456',
          serverName: 'Broker-Demo',
          isLive: false,
          symbols: [{ platformSymbol: 'XAUUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 }],
        },
      });
    }
    return response({
      ok: false,
      type: 'result',
      reason: 'order_check failed: retcode=10025 No changes last_error=1 Success',
      positionId: '12345',
    }, { ok: false, status: 409 });
  };

  const result = await executeMt5ConnectorAction({
    type: 'MODIFY_POSITION',
    symbol: 'XAUUSD',
    brokerPositionId: '12345',
    stopLoss: 2500,
    takeProfit: 2550,
    idempotencyKey: 'event-2:acct-1:modify:1',
  }, {
    workspaceId: 'ws1',
    accountRowId: 'acct-1',
    gatewayUrl: 'https://gateway.example',
    controlSecret: 'secret',
    expectedBrokerAccountId: '50123456',
    expectedServerName: 'Broker-Demo',
    expectedEnvironment: 'demo',
    symbolCatalog: [{ platformSymbol: 'XAUUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 }],
    deliveryStore,
    fetchFn,
  });

  assert.equal(call, 2);
  assert.equal(result.alreadyCurrent, true);
  assert.equal(result.brokerPositionId, '12345');
  assert.equal(completed.length, 1);
  assert.equal(failures.length, 0);
});
