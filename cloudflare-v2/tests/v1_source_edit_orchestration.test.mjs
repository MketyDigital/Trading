import test from 'node:test';
import assert from 'node:assert/strict';

import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

function event() {
  return {
    external_event_id: 'telegram:-1001:317',
    workspace_hint: 'ws-1',
    source: { instance_id: 'source-1' },
    text: 'SELL XAUUSD ENTRY 4273.25-4279.76 SL 4390 TP 4240',
    thread: { edited_event_id: 'telegram:-1001:317' },
    metadata: { telegram_update_kind: 'edited_message' },
  };
}

function interpretation() {
  return {
    status: 'READY',
    source: 'deterministic',
    intent: {
      side: 'SELL',
      orderType: 'LIMIT',
      symbol: { canonical: 'XAUUSD' },
      entry: { kind: 'RANGE', min: 4273.25, max: 4279.76 },
      stopLoss: 4390,
      takeProfits: [4240],
      incomplete: false,
      fastEntry: false,
    },
  };
}

function group(id, accountId, positionId) {
  return {
    id,
    workspaceId: 'ws-1',
    tradeAccountId: accountId,
    sourceInstanceId: 'source-1',
    sourceEventIds: ['telegram:-1001:317'],
    symbol: 'XAUUSD',
    side: 'SELL',
    orderType: 'LIMIT',
    entry: { kind: 'RANGE', min: 4273.25, max: 4279.76 },
    stopLoss: 4380,
    status: 'OPEN',
    incomplete: false,
    legs: [{
      legId: `${id}-leg-1`,
      targetIndex: 1,
      lots: 0.01,
      status: 'OPEN',
      brokerPositionId: positionId,
      stopLoss: 4380,
      takeProfit: 4250,
    }],
    createdAt: 1000,
    updatedAt: 2000,
  };
}

function account(id) {
  return {
    id,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false, allowedSymbols: ['XAUUSD'] },
  };
}

test('edited signal orchestrates protection changes on the matched group without an OPEN action', async () => {
  const stored = group('group-a', 'acct-a', 'position-a');
  const persisted = [];
  const result = await orchestrateTradingEventSimulation({
    event: event(),
    interpretation: interpretation(),
    eventId: 'db-edit-1',
    nowMs: 3000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'EDIT_TARGET', groupId: 'group-a' }) },
    stateStore: {
      getGroup: async () => structuredClone(stored),
      putGroup: async (value) => { persisted.push(structuredClone(value)); return value; },
    },
    accountProvider: async () => [account('acct-a')],
    instrumentProvider: async () => { throw new Error('edit management must not require a new execution plan'); },
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions, [{
    type: 'MODIFY_POSITION',
    legId: 'group-a-leg-1',
    targetIndex: 1,
    brokerPositionId: 'position-a',
    symbol: 'XAUUSD',
    stopLoss: 4390,
    takeProfit: 4240,
    simulated: true,
  }]);
  assert.equal(result.accounts[0].actions.some((action) => action.type === 'OPEN_POSITION'), false);
  assert.equal(persisted.length, 1);
});

test('edited signal fans the same semantic revision across every account group in one logical cohort', async () => {
  const groups = new Map([
    ['group-a', group('group-a', 'acct-a', 'position-a')],
    ['group-b', group('group-b', 'acct-b', 'position-b')],
  ]);
  const result = await orchestrateTradingEventSimulation({
    event: event(),
    interpretation: interpretation(),
    eventId: 'db-edit-2',
    nowMs: 3000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'EDIT_TARGET', groupIds: ['group-a', 'group-b'] }) },
    stateStore: {
      getGroup: async (id) => structuredClone(groups.get(id) || null),
      putGroup: async (value) => value,
    },
    accountProvider: async () => [account('acct-a'), account('acct-b')],
    instrumentProvider: async () => { throw new Error('edit management must not require market metadata'); },
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts.length, 2);
  assert.ok(result.accounts.every((item) => item.status === 'READY'));
  assert.deepEqual(result.accounts.map((item) => item.actions[0].brokerPositionId), ['position-a', 'position-b']);
  assert.ok(result.accounts.every((item) => item.actions.every((action) => action.type === 'MODIFY_POSITION')));
});
