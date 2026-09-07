import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

function account() {
  return {
    id: 'acct-1',
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

function plannedGroup() {
  return {
    id: 'group-1',
    tradeAccountId: 'acct-1',
    workspaceId: 'ws-1',
    sourceInstanceId: 'acceptance-harness',
    sourceEventIds: ['signal-1'],
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 2500,
    entry: { kind: 'PRICE', value: 2500 },
    stopLoss: 2490,
    status: 'PLANNED',
    incomplete: false,
    legs: [
      { legId: 'leg-1', targetIndex: 1, lots: 0.03, stopLoss: 2490, takeProfit: 2510, status: 'PLANNED' },
      { legId: 'leg-2', targetIndex: 2, lots: 0.03, stopLoss: 2490, takeProfit: 2520, status: 'PLANNED' },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function deps(existing, persisted) {
  return {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupId: existing.id }) },
    stateStore: {
      getGroup: async () => structuredClone(existing),
      putGroup: async (group) => { persisted.push(structuredClone(group)); return group; },
    },
    accountProvider: async () => [account()],
    instrumentProvider: async () => { throw new Error('management simulation must not require market metadata'); },
  };
}

test('reply-targeted BE can simulate against PLANNED canonical legs without inventing broker position ids', async () => {
  const existing = plannedGroup();
  const persisted = [];
  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'management-1',
      workspace_hint: 'ws-1',
      source: { instance_id: 'acceptance-harness' },
      thread: { reply_to_event_id: 'signal-1' },
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } },
    eventId: 'db-management-1',
    nowMs: 2000,
  }, deps(existing, persisted));

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.executionEnabled, false);
  assert.equal(result.correlation.reason, 'REPLY_TARGET');
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].groupId, 'group-1');
  assert.deepEqual(result.accounts[0].actions.map((action) => action.type), ['MODIFY_POSITION', 'MODIFY_POSITION']);
  assert.deepEqual(result.accounts[0].actions.map((action) => action.legId), ['leg-1', 'leg-2']);
  assert.equal(result.accounts[0].actions.every((action) => action.brokerPositionId == null), true);
  assert.equal(result.accounts[0].actions.every((action) => action.stopLoss === 2500 && action.simulated === true), true);
  assert.deepEqual(persisted[0].sourceEventIds, ['signal-1', 'management-1']);
});

test('reply-targeted half close can simulate canonical lots on PLANNED legs', async () => {
  const existing = plannedGroup();
  const persisted = [];
  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'management-2',
      workspace_hint: 'ws-1',
      source: { instance_id: 'acceptance-harness' },
      thread: { reply_to_event_id: 'signal-1' },
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 } },
    eventId: 'db-management-2',
    nowMs: 2000,
  }, deps(existing, persisted));

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions.map((action) => action.type), ['CLOSE_PARTIAL', 'CLOSE_PARTIAL']);
  assert.deepEqual(result.accounts[0].actions.map((action) => action.legId), ['leg-1', 'leg-2']);
  assert.equal(result.accounts[0].actions.every((action) => action.fraction === 0.5 && action.lots === 0.02 && action.simulated === true), true);
  assert.deepEqual(persisted[0].sourceEventIds, ['signal-1', 'management-2']);
});
