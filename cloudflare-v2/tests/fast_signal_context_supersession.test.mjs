import test from 'node:test';
import assert from 'node:assert/strict';

import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';
import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

const now = 1_800_000_000_000;

function fastSell(overrides = {}) {
  return {
    id: 'eurjpy-fast-sell', workspaceId: 'ws', tradeAccountId: 'acct',
    sourceInstanceId: 'main signal2', sourceEventIds: ['telegram:-1001888176046:10205'],
    threadId: null, symbol: 'EURJPY', side: 'SELL', orderType: 'MARKET',
    status: 'OPEN', incomplete: true, createdAt: now - 4 * 60 * 1000,
    updatedAt: now - 4 * 60 * 1000,
    legs: [{ legId: 'sell-leg', targetIndex: 1, lots: 0.05, status: 'OPEN', brokerPositionId: 'sell-position' }],
    ...overrides,
  };
}

function buyRequest(thread = {}) {
  return {
    event: {
      workspace_hint: 'ws', source: { instance_id: 'main signal2' },
      external_event_id: 'telegram:-1001888176046:10206', thread,
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'EURJPY' }, side: 'BUY', orderType: 'MARKET',
        entry: { kind: 'PRICE', value: 176.755 }, stopLoss: 176.371,
        takeProfits: [177.098, 177.552, 177.931], fastEntry: true, incomplete: false,
      },
    },
  };
}

test('a recent opposite fast group is superseded only within the same workspace and source instance', () => {
  const request = buyRequest();
  assert.deepEqual(correlateTradingEvent({ ...request, activeGroups: [fastSell()], nowMs: now }), {
    status: 'MATCHED', reason: 'FAST_ENTRY_SUPERSESSION', groupId: 'eurjpy-fast-sell',
  });
  assert.deepEqual(correlateTradingEvent({
    ...request, activeGroups: [fastSell({ sourceInstanceId: 'another listener' })], nowMs: now,
  }), { status: 'NEW_GROUP' });
  assert.deepEqual(correlateTradingEvent({
    ...request, activeGroups: [fastSell({ createdAt: now - 5 * 60 * 1000 - 1 })], nowMs: now,
  }), { status: 'NEW_GROUP' });
});

test('opposite signal plan closes the old position first and holds the new entry if close fails', async () => {
  const previous = fastSell();
  const saved = [];
  const planned = await orchestrateTradingEventSimulation({
    ...buyRequest(), eventId: 'db-buy', nowMs: now,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'FAST_ENTRY_SUPERSESSION', groupId: previous.id }) },
    stateStore: {
      getGroup: async () => structuredClone(previous),
      putGroup: async (group) => { saved.push(structuredClone(group)); return group; },
    },
    accountProvider: async () => [{
      id: 'acct', workspace_id: 'ws', execution_enabled: true,
      sizingMode: 'FIXED_LOTS', fixedLots: 0.05,
      safety_policy: { enabled: true, killSwitch: false, allowedSymbols: ['EURJPY'], maxLotsPerTrade: 1 },
    }],
    instrumentProvider: async () => ({ canonical: 'EURJPY', tickSize: 0.001, tickValue: 1, minLots: 0.01, maxLots: 10, stepLots: 0.01 }),
    exposureProvider: async () => ({}),
    marketPriceProvider: async () => 176.8,
  });

  assert.equal(planned.status, 'SIMULATED');
  assert.equal(planned.accounts[0].supersessionCloseActionCount, 1);
  assert.deepEqual(planned.accounts[0].actions.slice(0, 2).map((action) => action.type), ['CLOSE_POSITION', 'OPEN_POSITION']);
  assert.equal(saved[0].side, 'BUY');

  const dispatched = [];
  const failedClose = await executeProductionPlan({
    workspaceId: 'ws', eventId: 'db-buy', brokerExecutionEnabled: true,
    accountPlans: [{
      accountId: 'acct', groupId: 'new-buy-group', supersessionCloseActionCount: 1,
      actions: [
        { type: 'CLOSE_POSITION', legId: 'sell-leg', executionGroupId: previous.id, symbol: 'EURJPY', lots: 0.05 },
        { type: 'OPEN_POSITION', legId: 'buy-leg', symbol: 'EURJPY', lots: 0.05 },
      ],
    }],
  }, {
    accountLoader: async () => ({ id: 'acct', workspace_id: 'ws', is_active: true, execution_enabled: true, safety_policy: { enabled: true, killSwitch: false } }),
    dispatchAction: async ({ groupId, action }) => {
      dispatched.push({ groupId, type: action.type });
      return action.type === 'CLOSE_POSITION' ? { ok: false, code: 'CLOSE_REJECTED' } : { ok: true };
    },
  });
  assert.equal(failedClose.accounts[0].status, 'FAILED');
  assert.deepEqual(dispatched, [{ groupId: previous.id, type: 'CLOSE_POSITION' }]);
});

test('replacement buy dispatches only after the old sell close succeeds', async () => {
  const dispatched = [];
  const result = await executeProductionPlan({
    workspaceId: 'ws', eventId: 'db-buy', brokerExecutionEnabled: true,
    accountPlans: [{
      accountId: 'acct', groupId: 'new-buy-group', supersessionCloseActionCount: 1,
      actions: [
        { type: 'CLOSE_POSITION', legId: 'sell-leg', executionGroupId: 'old-sell-group', symbol: 'EURJPY', lots: 0.05 },
        { type: 'OPEN_POSITION', legId: 'buy-leg', symbol: 'EURJPY', lots: 0.05 },
      ],
    }],
  }, {
    accountLoader: async () => ({ id: 'acct', workspace_id: 'ws', is_active: true, execution_enabled: true, safety_policy: { enabled: true, killSwitch: false } }),
    dispatchAction: async ({ groupId, action }) => {
      dispatched.push({ groupId, type: action.type });
      return action.type === 'CLOSE_POSITION' ? { ok: true, reconciledClosed: true } : { ok: true, brokerPositionId: 'buy-position' };
    },
    stateBinder: async () => {},
  });

  assert.equal(result.accounts[0].status, 'SUCCEEDED');
  assert.deepEqual(dispatched, [
    { groupId: 'old-sell-group', type: 'CLOSE_POSITION' },
    { groupId: 'new-buy-group', type: 'OPEN_POSITION' },
  ]);
});
