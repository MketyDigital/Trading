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

function pendingGroup(overrides = {}) {
  return {
    id: 'pending-group-1',
    tradeAccountId: 'acct-1',
    workspaceId: 'ws-1',
    sourceInstanceId: 'acceptance-harness',
    sourceEventIds: ['pending-signal-1'],
    symbol: 'EURUSD',
    side: 'BUY',
    orderType: 'LIMIT',
    entryPrice: 1.16,
    entry: { kind: 'PRICE', value: 1.16 },
    stopLoss: 1.157,
    status: 'PLANNED',
    incomplete: false,
    legs: [
      { legId: 'pending-leg-1', targetIndex: 1, lots: 0.01, stopLoss: 1.157, takeProfit: 1.165, status: 'PLANNED' },
    ],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
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
    instrumentProvider: async () => { throw new Error('pending cancellation must not require market metadata'); },
  };
}

test('reply-targeted cancel pending simulates canonical cancellation for PLANNED non-market legs without broker order ids', async () => {
  const existing = pendingGroup();
  const persisted = [];
  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'cancel-1',
      workspace_hint: 'ws-1',
      source: { instance_id: 'acceptance-harness' },
      thread: { reply_to_event_id: 'pending-signal-1' },
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING' } },
    eventId: 'db-cancel-1',
    nowMs: 2000,
  }, deps(existing, persisted));

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.executionEnabled, false);
  assert.equal(result.correlation.reason, 'REPLY_TARGET');
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].groupId, 'pending-group-1');
  assert.deepEqual(result.accounts[0].actions.map((action) => action.type), ['CANCEL_PENDING']);
  assert.equal(result.accounts[0].actions[0].legId, 'pending-leg-1');
  assert.equal(result.accounts[0].actions[0].brokerOrderId, undefined);
  assert.equal(result.accounts[0].actions[0].simulated, true);
  assert.deepEqual(persisted[0].sourceEventIds, ['pending-signal-1', 'cancel-1']);
});

test('cancel pending fails closed for a PLANNED market-position group', async () => {
  const existing = pendingGroup({ orderType: 'MARKET', symbol: 'XAUUSD' });
  const persisted = [];
  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'cancel-market',
      workspace_hint: 'ws-1',
      source: { instance_id: 'acceptance-harness' },
      thread: { reply_to_event_id: 'pending-signal-1' },
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING' } },
    eventId: 'db-cancel-market',
    nowMs: 2000,
  }, deps(existing, persisted));

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.equal(result.accounts[0].reason, 'MANAGEMENT_ACTION_UNAVAILABLE');
  assert.deepEqual(result.accounts[0].actions, []);
  assert.equal(persisted.length, 0);
});
