import test from 'node:test';
import assert from 'node:assert/strict';

import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

test('fresh self-edited FBS limit signal creates all pending legs beside an unrelated open trade', async () => {
  const nowMs = 1700000000000;
  const eventId = 'telegram:-1001888176046:10186';
  const saved = [];
  const unrelatedTrade = {
    id: 'gbpcad-fast',
    workspaceId: 'ws',
    tradeAccountId: 'fbs-live',
    sourceInstanceId: 'main signal2',
    sourceEventIds: ['telegram:-1001888176046:10180'],
    symbol: 'GBPCAD',
    side: 'BUY',
    orderType: 'MARKET',
    entry: { kind: 'MARKET', executedPrice: 1.88243 },
    entryPrice: 1.88243,
    incomplete: true,
    status: 'OPEN',
    createdAt: nowMs - 1000,
    updatedAt: nowMs - 1000,
    legs: [],
  };
  const event = {
    external_event_id: eventId,
    occurred_at: new Date(nowMs - 500).toISOString(),
    workspace_hint: 'ws',
    source: { instance_id: 'main signal2' },
    thread: { edited_event_id: eventId },
    text: 'EURAUD SELL-LIMIT @ 1.61273',
  };
  const interpretation = {
    status: 'READY',
    intent: {
      symbol: { canonical: 'EURAUD' },
      side: 'SELL',
      orderType: 'LIMIT',
      entry: { kind: 'PRICE', value: 1.61273 },
      stopLoss: 1.61523,
      takeProfits: [1.61048, 1.60764, 1.605],
      fastEntry: false,
      incomplete: false,
    },
  };

  const result = await orchestrateTradingEventSimulation({ event, interpretation, eventId, nowMs }, {
    stateCoordinator: {
      correlate: async (incoming, parsed, timestamp) => correlateTradingEvent({
        event: incoming,
        interpretation: parsed,
        activeGroups: [unrelatedTrade],
        nowMs: timestamp,
      }),
    },
    stateStore: {
      putGroup: async (group) => saved.push(structuredClone(group)),
    },
    accountProvider: async () => [{
      id: 'fbs-live',
      workspace_id: 'ws',
      execution_enabled: true,
      lot_sizing_type: 'fixed',
      lot_value: 0.05,
      safety_policy: { killSwitch: false, autoTpProtection: true },
      entry_zone_policy: { mode: 'market_only' },
    }],
    instrumentProvider: async () => ({
      canonical: 'EURAUD',
      platformSymbol: 'EURAUD',
      minLots: 0.01,
      maxLots: 100,
      stepLots: 0.01,
    }),
    marketPriceProvider: async () => { throw new Error('explicit pending limit must not require a quote'); },
  });

  assert.equal(result.status, 'SIMULATED');
  assert.deepEqual(result.correlation, { status: 'NEW_GROUP' });
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].accountId, 'fbs-live');
  assert.deepEqual(result.accounts[0].actions.map(({ type, orderType, entry, takeProfit }) => ({ type, orderType, entry, takeProfit })), [
    { type: 'OPEN_POSITION', orderType: 'LIMIT', entry: { kind: 'PRICE', value: 1.61273 }, takeProfit: 1.61048 },
    { type: 'OPEN_POSITION', orderType: 'LIMIT', entry: { kind: 'PRICE', value: 1.61273 }, takeProfit: 1.60764 },
    { type: 'OPEN_POSITION', orderType: 'LIMIT', entry: { kind: 'PRICE', value: 1.61273 }, takeProfit: 1.605 },
  ]);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].sourceEventIds, [eventId]);
  assert.equal(saved[0].orderType, 'LIMIT');
  assert.equal(saved[0].entryPrice, 1.61273);
});
