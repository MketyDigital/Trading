import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

const event = {
  external_event_id: 'evt-101',
  source: { instance_id: 'listener-1' },
  thread: {},
};

const interpretation = {
  status: 'READY',
  intent: {
    side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    takeProfits: [2510, 2520, 2530], fastEntry: false, incomplete: false,
  },
};

const instrument = {
  canonical: 'XAUUSD', tickSize: 0.01, tickValue: 1,
  minLots: 0.01, maxLots: 100, stepLots: 0.01,
};

function enabledAccount(overrides = {}) {
  return {
    id: 'acct-1', execution_enabled: true, sizingMode: 'FIXED_LOTS', fixedLots: 0.03,
    safety_policy: { enabled: true, killSwitch: false, allowedSymbols: ['XAUUSD'], maxLotsPerTrade: 1 },
    fast_entry_policy: 'wait_for_complete_signal',
    ...overrides,
  };
}

test('correlates, applies account safety, builds Position Group and returns simulation actions without broker dispatch', async () => {
  const persisted = [];
  let brokerCalled = false;
  const result = await orchestrateTradingEventSimulation({ event, interpretation, eventId: 'db-event-1' }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEW_GROUP' }) },
    stateStore: { putGroup: async (group) => { persisted.push(group); return group; } },
    accountProvider: async () => [enabledAccount(), enabledAccount({ id: 'acct-off', execution_enabled: false })],
    instrumentProvider: async () => instrument,
    exposureProvider: async () => ({ currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 }),
    marketPriceProvider: async () => 2500,
    brokerExecutor: async () => { brokerCalled = true; },
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.executionEnabled, false);
  assert.equal(brokerCalled, false);
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].actions.length, 3);
  assert.equal(result.accounts[1].status, 'SKIPPED');
  assert.equal(result.accounts[1].reason, 'EXECUTION_DISABLED');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].tradeAccountId, 'acct-1');
  assert.equal(persisted[0].sourceInstanceId, 'listener-1');
  assert.deepEqual(persisted[0].sourceEventIds, ['evt-101']);
});

test('account safety rejection produces zero simulated actions and does not persist a Position Group', async () => {
  let persisted = false;
  const result = await orchestrateTradingEventSimulation({ event, interpretation, eventId: 'db-event-2' }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEW_GROUP' }) },
    stateStore: { putGroup: async () => { persisted = true; } },
    accountProvider: async () => [enabledAccount({ safety_policy: { enabled: true, killSwitch: true } })],
    instrumentProvider: async () => instrument,
    exposureProvider: async () => ({}),
    marketPriceProvider: async () => 2500,
  });

  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.deepEqual(result.accounts[0].actions, []);
  assert.equal(result.accounts[0].policy.reasons.includes('KILL_SWITCH'), true);
  assert.equal(persisted, false);
});

test('fast signal honors wait_for_complete_signal policy and remains action-free', async () => {
  const fast = { status: 'READY', intent: { ...interpretation.intent, fastEntry: true, incomplete: true, takeProfits: [] } };
  const result = await orchestrateTradingEventSimulation({ event, interpretation: fast, eventId: 'db-event-3' }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEW_GROUP' }) },
    stateStore: { putGroup: async () => { throw new Error('must not persist waiting fast signal'); } },
    accountProvider: async () => [enabledAccount()],
    instrumentProvider: async () => instrument,
    exposureProvider: async () => ({}),
    marketPriceProvider: async () => 2500,
  });

  assert.equal(result.accounts[0].status, 'WAITING');
  assert.equal(result.accounts[0].reason, 'WAIT_FOR_COMPLETE_SIGNAL');
  assert.deepEqual(result.accounts[0].actions, []);
});

test('ambiguous correlation remains action-free and cannot create another group', async () => {
  let persisted = false;
  const result = await orchestrateTradingEventSimulation({ event, interpretation, eventId: 'db-event-4' }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_FAST_ENTRY_COMPLETION' }) },
    stateStore: { putGroup: async () => { persisted = true; } },
    accountProvider: async () => [enabledAccount()],
    instrumentProvider: async () => instrument,
  });

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.actions, []);
  assert.equal(persisted, false);
});

test('fast-entry completion reuses existing group, promotes first leg to TP1 and opens only missing targets', async () => {
  const existing = {
    id: 'existing-group',
    tradeAccountId: 'acct-1',
    workspaceId: 'workspace-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['evt-fast'],
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
      { legId: 'fast-leg-1', targetIndex: 1, lots: 0.03, stopLoss: null, takeProfit: null, status: 'PLANNED' },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };
  let persisted;

  const result = await orchestrateTradingEventSimulation({
    event: { ...event, workspace_hint: 'workspace-1', external_event_id: 'evt-complete' },
    interpretation,
    eventId: 'db-event-complete',
    nowMs: 2000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'existing-group' }) },
    stateStore: {
      getGroup: async (groupId) => groupId === 'existing-group' ? structuredClone(existing) : null,
      putGroup: async (group) => { persisted = structuredClone(group); return group; },
    },
    accountProvider: async () => [enabledAccount({ fixedLots: 0.09 })],
    instrumentProvider: async () => instrument,
    exposureProvider: async () => ({ currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 }),
    marketPriceProvider: async () => 2500,
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.executionEnabled, false);
  assert.equal(result.correlation.reason, 'FAST_ENTRY_COMPLETION');
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].groupId, 'existing-group');
  assert.deepEqual(result.accounts[0].actions.map((action) => action.type), [
    'MODIFY_POSITION',
    'OPEN_POSITION',
    'OPEN_POSITION',
  ]);
  assert.equal(result.accounts[0].actions[0].legId, 'fast-leg-1');
  assert.equal(result.accounts[0].actions[0].targetIndex, 1);
  assert.equal(result.accounts[0].actions[0].takeProfit, 2510);
  assert.equal(result.accounts[0].actions[0].simulated, true);
  assert.deepEqual(result.accounts[0].actions.slice(1).map((action) => action.targetIndex), [2, 3]);
  assert.equal(result.accounts[0].actions.every((action) => action.simulated === true), true);

  assert.equal(persisted.id, 'existing-group');
  assert.equal(persisted.incomplete, false);
  assert.deepEqual(persisted.sourceEventIds, ['evt-fast', 'evt-complete']);
  assert.equal(persisted.legs.length, 3);
  assert.equal(persisted.legs[0].legId, 'fast-leg-1');
  assert.equal(persisted.legs[0].takeProfit, 2510);
  assert.deepEqual(persisted.legs.map((leg) => leg.lots), [0.03, 0.03, 0.03]);
});
