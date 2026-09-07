import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

const event = {
  workspace_hint: 'workspace-1',
  external_event_id: 'evt-complete',
  source: { instance_id: 'listener-1' },
  thread: {},
};

const interpretation = {
  status: 'READY',
  intent: {
    side: 'BUY',
    orderType: 'MARKET',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 },
    stopLoss: 2490,
    takeProfits: [2510, 2520, 2530],
    fastEntry: false,
    incomplete: false,
  },
};

const instrument = {
  canonical: 'XAUUSD',
  tickSize: 0.01,
  tickValue: 1,
  minLots: 0.01,
  maxLots: 100,
  stepLots: 0.01,
};

function account(id, overrides = {}) {
  return {
    id,
    execution_enabled: true,
    sizingMode: 'FIXED_LOTS',
    fixedLots: 0.09,
    safety_policy: {
      enabled: true,
      killSwitch: false,
      allowedSymbols: ['XAUUSD'],
      maxLotsPerTrade: 1,
    },
    ...overrides,
  };
}

function fastGroup(id, tradeAccountId) {
  return {
    id,
    tradeAccountId,
    workspaceId: 'workspace-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['evt-fast-source'],
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 2500,
    entry: { kind: 'MARKET' },
    stopLoss: null,
    status: 'PLANNED',
    incomplete: true,
    positionMode: 'HEDGED',
    legs: [
      {
        legId: `${id}-leg-1`,
        targetIndex: 1,
        lots: 0.03,
        stopLoss: null,
        takeProfit: null,
        status: 'PLANNED',
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

test('completed signal reconciles every matched fast account and opens normally for an account that waited', async () => {
  const groups = new Map([
    ['group-a', fastGroup('group-a', 'acct-a')],
    ['group-b', fastGroup('group-b', 'acct-b')],
  ]);
  const persisted = [];

  const result = await orchestrateTradingEventSimulation({
    event,
    interpretation,
    eventId: 'db-event-complete',
    nowMs: 2000,
  }, {
    stateCoordinator: {
      correlate: async () => ({
        status: 'MATCHED',
        reason: 'FAST_ENTRY_COMPLETION',
        groupIds: ['group-a', 'group-b'],
      }),
    },
    stateStore: {
      getGroup: async (groupId) => structuredClone(groups.get(groupId) || null),
      putGroup: async (group) => {
        persisted.push(structuredClone(group));
        return group;
      },
    },
    accountProvider: async () => [
      account('acct-a', { fast_entry_policy: 'execute_immediately' }),
      account('acct-b', { fast_entry_policy: 'execute_immediately' }),
      account('acct-wait', { fast_entry_policy: 'wait_for_complete_signal' }),
    ],
    instrumentProvider: async () => instrument,
    exposureProvider: async () => ({ currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 }),
    marketPriceProvider: async () => 2500,
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts.length, 3);

  const byAccount = new Map(result.accounts.map((row) => [row.accountId, row]));
  assert.deepEqual(byAccount.get('acct-a').actions.map((action) => action.type), [
    'MODIFY_POSITION', 'OPEN_POSITION', 'OPEN_POSITION',
  ]);
  assert.equal(byAccount.get('acct-a').groupId, 'group-a');
  assert.deepEqual(byAccount.get('acct-b').actions.map((action) => action.type), [
    'MODIFY_POSITION', 'OPEN_POSITION', 'OPEN_POSITION',
  ]);
  assert.equal(byAccount.get('acct-b').groupId, 'group-b');

  assert.deepEqual(byAccount.get('acct-wait').actions.map((action) => action.type), [
    'OPEN_POSITION', 'OPEN_POSITION', 'OPEN_POSITION',
  ]);
  assert.equal(byAccount.get('acct-wait').groupId, 'db-event-complete:acct-wait');

  assert.equal(persisted.length, 3);
  assert.equal(persisted.filter((group) => group.id === 'group-a').length, 1);
  assert.equal(persisted.filter((group) => group.id === 'group-b').length, 1);
  assert.equal(persisted.filter((group) => group.id === 'db-event-complete:acct-wait').length, 1);
  assert.equal(result.accounts.every((row) => row.actions.every((action) => action.simulated === true)), true);
});
