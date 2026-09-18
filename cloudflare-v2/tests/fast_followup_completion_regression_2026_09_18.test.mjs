import test from 'node:test';
import assert from 'node:assert/strict';

import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

test('replied full signal completes an existing fast-entry trade instead of becoming correlated with zero actions', async () => {
  const saved = [];
  const existing = {
    id: 'fast-group',
    workspaceId: 'ws',
    tradeAccountId: 'acct',
    sourceInstanceId: 'src',
    sourceEventIds: ['telegram:-1001:10'],
    threadId: null,
    symbol: 'DERIV:VOLATILITY_75',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 44798.73,
    entry: { kind: 'MARKET', executedPrice: 44798.73 },
    stopLoss: null,
    incomplete: true,
    status: 'OPEN',
    createdAt: 1000,
    updatedAt: 1000,
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0.03,
      status: 'OPEN',
      brokerPositionId: 'p1',
      brokerOrderId: 'o1',
      stopLoss: null,
      takeProfit: null,
    }],
  };

  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'telegram:-1001:11',
      workspace_hint: 'ws',
      source: { instance_id: 'src' },
      thread: { reply_to_event_id: 'telegram:-1001:10' },
      text: 'full signal',
    },
    eventId: 'evt-full',
    nowMs: 2000,
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'DERIV:VOLATILITY_75' },
        side: 'BUY',
        orderType: 'MARKET',
        entry: { kind: 'RANGE', min: 44750, max: 44800 },
        stopLoss: 44450,
        takeProfits: [44950, 45150, 45350],
        fastEntry: false,
        incomplete: false,
      },
    },
  }, {
    stateCoordinator: {
      correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'fast-group' }),
    },
    stateStore: {
      getGroup: async (id) => id === 'fast-group' ? existing : null,
      putGroup: async (group) => saved.push(structuredClone(group)),
    },
    accountProvider: async () => [{
      id: 'acct',
      workspace_id: 'ws',
      execution_enabled: true,
      sizingMode: 'FIXED_LOTS',
      fixedLots: 0.03,
      safety_policy: { enabled: true, killSwitch: false },
      entry_zone_policy: { mode: 'market_if_inside' },
    }],
    instrumentProvider: async () => ({
      stepLots: 0.01,
      minLots: 0.01,
      maxLots: 10,
    }),
    marketPriceProvider: async () => 44798.73,
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].groupId, 'fast-group');
  assert.equal(result.accounts[0].actions[0].type, 'MODIFY_POSITION');
  assert.equal(result.accounts[0].actions[0].brokerPositionId, 'p1');
  assert.equal(result.accounts[0].actions[0].stopLoss, 44450);
  assert.equal(result.accounts[0].actions[0].takeProfit, 44950);
  assert.equal(result.accounts[0].actions.length, 3);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].incomplete, false);
  assert.deepEqual(saved[0].sourceEventIds, ['telegram:-1001:10', 'telegram:-1001:11']);
});


test('implicit same-symbol fast completion remains executable with production fixed-lot fallback constraints', async () => {
  const saved = [];
  const existing = {
    id: 'gold-fast',
    workspaceId: 'ws',
    tradeAccountId: 'acct',
    sourceInstanceId: 'src',
    sourceEventIds: ['telegram:-1001:20'],
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entry: { kind: 'MARKET', executedPrice: 4394.01 },
    entryPrice: 4394.01,
    stopLoss: null,
    incomplete: true,
    status: 'OPEN',
    createdAt: 1000,
    updatedAt: 1000,
    legs: [{
      legId: 'leg-1', targetIndex: 1, lots: 0.2, status: 'OPEN',
      brokerPositionId: 'gold-pos', brokerOrderId: 'gold-order',
      stopLoss: null, takeProfit: null,
    }],
  };

  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'telegram:-1001:21',
      workspace_hint: 'ws',
      source: { instance_id: 'src' },
      thread: {},
      text: 'XAUUSD BUY full signal',
    },
    eventId: 'evt-gold-full',
    nowMs: 2000,
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'XAUUSD' },
        side: 'BUY',
        orderType: 'MARKET',
        entry: { kind: 'RANGE', min: 4300, max: 4400 },
        stopLoss: 4100,
        takeProfits: [4450, 4500, 4570.99],
        fastEntry: false,
        incomplete: false,
      },
    },
  }, {
    stateCoordinator: {
      correlate: async () => ({ status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'gold-fast' }),
    },
    stateStore: {
      getGroup: async (id) => id === 'gold-fast' ? existing : null,
      putGroup: async (group) => saved.push(structuredClone(group)),
    },
    accountProvider: async () => [{
      id: 'acct', workspace_id: 'ws', execution_enabled: true,
      lot_sizing_type: 'fixed', lot_value: 0.2,
      safety_policy: { killSwitch: false, autoTpProtection: true },
      entry_zone_policy: { mode: 'market_only' },
    }],
    instrumentProvider: async () => ({
      canonical: 'XAUUSD', platformSymbol: 'XAUUSD',
      minLots: 0.2, maxLots: 0.2, stepLots: 0.2,
    }),
    marketPriceProvider: async () => undefined,
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].actions.length, 3);
  assert.equal(result.accounts[0].actions[0].type, 'MODIFY_POSITION');
  assert.equal(result.accounts[0].actions[0].stopLoss, 4100);
  assert.equal(result.accounts[0].actions[0].takeProfit, 4450);
});
