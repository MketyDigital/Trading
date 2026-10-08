import test from 'node:test';
import assert from 'node:assert/strict';

import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

test('market_only uses the current quote instead of a single reference entry on a MARKET signal', async () => {
  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'telegram:-1001:920',
      workspace_hint: 'ws',
      source: { instance_id: 'src' },
      thread: {},
    },
    eventId: 'market-only-price-hint',
    nowMs: 2000,
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'EURUSD' },
        side: 'BUY',
        orderType: 'MARKET',
        entry: { kind: 'PRICE', value: 1.09 },
        stopLoss: 1.08,
        takeProfits: [1.12, 1.13],
        fastEntry: false,
        incomplete: false,
      },
    },
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEW_GROUP' }) },
    stateStore: { putGroup: async () => {} },
    accountProvider: async () => [{
      id: 'fbs-live',
      workspace_id: 'ws',
      execution_enabled: true,
      lot_sizing_type: 'fixed',
      lot_value: 0.03,
      safety_policy: { killSwitch: false, autoTpProtection: true },
      entry_zone_policy: { mode: 'market_only' },
    }],
    instrumentProvider: async () => ({ canonical: 'EURUSD', platformSymbol: 'EURUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 }),
    marketPriceProvider: async () => 1.1,
  });

  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions.map(({ orderType, entry }) => ({ orderType, entry })), [
    { orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: 1.1 } },
    { orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: 1.1 } },
  ]);
});

test('market_only uses the current quote when a MARKET signal has no entry field', async () => {
  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'telegram:-1001:922',
      workspace_hint: 'ws',
      source: { instance_id: 'src' },
      thread: {},
    },
    eventId: 'market-only-no-entry',
    nowMs: 2000,
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'EURUSD' },
        side: 'BUY',
        orderType: 'MARKET',
        stopLoss: 1.08,
        takeProfits: [1.12],
        fastEntry: false,
        incomplete: false,
      },
    },
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEW_GROUP' }) },
    stateStore: { putGroup: async () => {} },
    accountProvider: async () => [{
      id: 'fbs-live',
      workspace_id: 'ws',
      execution_enabled: true,
      lot_sizing_type: 'fixed',
      lot_value: 0.03,
      safety_policy: { killSwitch: false, autoTpProtection: true },
      entry_zone_policy: { mode: 'market_only' },
    }],
    instrumentProvider: async () => ({ canonical: 'EURUSD', platformSymbol: 'EURUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 }),
    marketPriceProvider: async () => 1.1,
  });

  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions.map(({ orderType, entry }) => ({ orderType, entry })), [
    { orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: 1.1 } },
  ]);
});

test('market_only keeps an explicitly priced STOP pending order at its specified entry', async () => {
  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'telegram:-1001:921',
      workspace_hint: 'ws',
      source: { instance_id: 'src' },
      thread: {},
    },
    eventId: 'market-only-stop-pending',
    nowMs: 2000,
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'EURUSD' },
        side: 'BUY',
        orderType: 'STOP',
        entry: { kind: 'PRICE', value: 1.105 },
        stopLoss: 1.09,
        takeProfits: [1.12, 1.13],
        fastEntry: false,
        incomplete: false,
      },
    },
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEW_GROUP' }) },
    stateStore: { putGroup: async () => {} },
    accountProvider: async () => [{
      id: 'fbs-live',
      workspace_id: 'ws',
      execution_enabled: true,
      lot_sizing_type: 'fixed',
      lot_value: 0.03,
      safety_policy: { killSwitch: false, autoTpProtection: true },
      entry_zone_policy: { mode: 'market_only' },
    }],
    instrumentProvider: async () => ({ canonical: 'EURUSD', platformSymbol: 'EURUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01 }),
    marketPriceProvider: async () => { throw new Error('explicit pending orders must not require a quote'); },
  });

  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions.map(({ orderType, entry }) => ({ orderType, entry })), [
    { orderType: 'STOP', entry: { kind: 'PRICE', value: 1.105 } },
    { orderType: 'STOP', entry: { kind: 'PRICE', value: 1.105 } },
  ]);
});

test('fast completion survives crossed TP1 and keeps valid SL plus later targets without duplicating leg 1', async () => {
  const saved = [];
  const existing = {
    id: 'gold-fast',
    workspaceId: 'ws',
    tradeAccountId: 'acct',
    sourceInstanceId: 'src',
    sourceEventIds: ['telegram:-1001:932'],
    symbol: 'XAUUSD',
    side: 'SELL',
    orderType: 'MARKET',
    entry: { kind: 'MARKET', executedPrice: 4363.78 },
    entryPrice: 4363.78,
    stopLoss: null,
    incomplete: true,
    status: 'OPEN',
    createdAt: 1000,
    updatedAt: 1000,
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0.2,
      status: 'OPEN',
      brokerPositionId: '138490038',
      brokerOrderId: '44271821',
      stopLoss: null,
      takeProfit: null,
    }],
  };

  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'telegram:-1001:933',
      workspace_hint: 'ws',
      source: { instance_id: 'src' },
      thread: {},
      text: 'GOLD SELL full signal',
    },
    eventId: 'evt-full',
    nowMs: 2000,
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'XAUUSD' },
        side: 'SELL',
        orderType: 'MARKET',
        entry: { kind: 'RANGE', min: 4365, max: 4375 },
        stopLoss: 4379,
        takeProfits: [4361, 4355, 4335],
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
      id: 'acct',
      workspace_id: 'ws',
      execution_enabled: true,
      lot_sizing_type: 'fixed',
      lot_value: 0.2,
      safety_policy: { killSwitch: false, autoTpProtection: true },
      entry_zone_policy: { mode: 'market_only' },
    }],
    instrumentProvider: async () => ({
      canonical: 'XAUUSD',
      platformSymbol: 'XAUUSD',
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.01,
    }),
    marketPriceProvider: async () => 4359,
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].groupId, 'gold-fast');

  const actions = result.accounts[0].actions;
  assert.equal(actions.filter((action) => action.type === 'OPEN_POSITION').length, 2);
  assert.equal(actions.filter((action) => action.type === 'MODIFY_POSITION').length, 1);

  const modify = actions.find((action) => action.type === 'MODIFY_POSITION');
  assert.equal(modify.brokerPositionId, '138490038');
  assert.equal(modify.stopLoss, 4379);
  assert.equal(Object.hasOwn(modify, 'takeProfit'), false);

  const opens = actions.filter((action) => action.type === 'OPEN_POSITION');
  assert.deepEqual(opens.map((action) => action.targetIndex), [2, 3]);
  assert.deepEqual(opens.map((action) => action.takeProfit), [4355, 4335]);

  assert.equal(saved.length, 1);
  assert.equal(saved[0].incomplete, false);
  assert.equal(saved[0].entryPrice, 4363.78);
  assert.deepEqual(saved[0].entry, { kind: 'MARKET', executedPrice: 4363.78 });
  assert.deepEqual(saved[0].sourceEventIds, ['telegram:-1001:932', 'telegram:-1001:933']);
  assert.equal(saved[0].legs[0].brokerPositionId, '138490038');
  assert.equal(saved[0].legs[0].stopLoss, 4379);
  assert.equal(saved[0].legs[0].takeProfit, null);
});
