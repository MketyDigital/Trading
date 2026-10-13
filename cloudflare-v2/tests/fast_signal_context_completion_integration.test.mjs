import test from 'node:test';
import assert from 'node:assert/strict';

import { TradeStateCoordinator, TradeStateStore } from '../src/state/trade_state_store.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
  async delete(key) { return this.map.delete(key); }
  async list({ prefix = '' } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(prefix))); }
}

test('EURJPY full signal without a valid reply enriches the open fast leg and appends missing targets once', async () => {
  const now = 1_800_000_000_000;
  const fastGroup = {
    id: 'eurjpy-fast-buy',
    workspaceId: 'ws-eurjpy',
    tradeAccountId: 'account-eurjpy',
    sourceInstanceId: 'main signal2',
    sourceEventIds: ['telegram:-1001888176046:10206'],
    threadId: null,
    symbol: 'EURJPY',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 176.755,
    entry: { kind: 'PRICE', value: 176.755, executedPrice: 176.755 },
    status: 'OPEN',
    incomplete: true,
    createdAt: now - 4 * 60 * 1000,
    updatedAt: now - 4 * 60 * 1000,
    legs: [{
      legId: 'eurjpy-fast-leg-1', targetIndex: 1, lots: 0.05, status: 'OPEN',
      brokerPositionId: 'eurjpy-position-1', stopLoss: null, takeProfit: null,
    }],
  };
  const stateStore = new TradeStateStore(new MemoryStorage(), { workspaceId: 'ws-eurjpy' });
  await stateStore.putGroup(fastGroup);
  const stateCoordinator = new TradeStateCoordinator(stateStore, { fastCompletionWindowMs: 30 * 60 * 1000 });
  const event = {
    workspace_hint: 'ws-eurjpy',
    source: { instance_id: 'main signal2' },
    external_event_id: 'telegram:-1001888176046:10208',
    thread: { reply_to_event_id: 'telegram:-1001888176046:10207' },
    text: 'EURJPY BUY with SL and three TP levels',
  };
  const interpretation = {
    status: 'READY',
    intent: {
      side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'EURJPY' },
      entry: { kind: 'PRICE', value: 176.755 }, stopLoss: 176.371,
      takeProfits: [177.098, 177.552, 177.931], fastEntry: false, incomplete: false,
    },
  };

  const result = await orchestrateTradingEventSimulation({ event, interpretation, eventId: 'db-eurjpy-full', nowMs: now }, {
    stateCoordinator,
    stateStore,
    accountProvider: async () => [{
      id: 'account-eurjpy', workspace_id: 'ws-eurjpy', execution_enabled: true,
      sizingMode: 'FIXED_LOTS', fixedLots: 0.05,
      safety_policy: { enabled: true, killSwitch: false, allowedSymbols: ['EURJPY'], maxLotsPerTrade: 1 },
    }],
    instrumentProvider: async () => ({ canonical: 'EURJPY', tickSize: 0.001, tickValue: 1, minLots: 0.01, maxLots: 10, stepLots: 0.01 }),
    exposureProvider: async () => ({}),
    marketPriceProvider: async () => 176.8,
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.correlation.reason, 'FAST_ENTRY_COMPLETION');
  assert.equal(result.accounts[0].groupId, 'eurjpy-fast-buy');
  assert.deepEqual(result.accounts[0].actions.map((action) => action.type), [
    'MODIFY_POSITION', 'OPEN_POSITION', 'OPEN_POSITION',
  ]);
  assert.equal(result.accounts[0].actions[0].brokerPositionId, 'eurjpy-position-1');
  assert.equal(result.accounts[0].actions[0].stopLoss, 176.371);
  assert.equal(result.accounts[0].actions[0].takeProfit, 177.098);

  const enriched = await stateStore.getGroup('eurjpy-fast-buy');
  assert.deepEqual(enriched.sourceEventIds, [
    'telegram:-1001888176046:10206', 'telegram:-1001888176046:10208',
  ]);
  assert.equal(enriched.incomplete, false);
  assert.equal(enriched.legs.length, 3);
  assert.equal(enriched.legs[0].brokerPositionId, 'eurjpy-position-1');
});
