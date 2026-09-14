import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMachinePlan } from '../src/pipeline/machine_plan.js';
import { buildManagementActions } from '../src/execution/position_group.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

function openGroup(overrides = {}) {
  return {
    id: 'group-1',
    tradeAccountId: 'acct-1',
    workspaceId: 'workspace-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['telegram:-1001:238'],
    symbol: 'BTCUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 77000,
    status: 'OPEN',
    legs: [
      { legId: 'leg-1', targetIndex: 1, lots: 0.02, status: 'OPEN', brokerPositionId: 'position-1' },
    ],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function enabledAccount(id = 'acct-1') {
  return {
    id,
    execution_enabled: true,
    sizingMode: 'FIXED_LOTS',
    fixedLots: 0.02,
    safety_policy: { enabled: true, killSwitch: false, allowedSymbols: ['BTCUSD'], maxLotsPerTrade: 1 },
  };
}

test('parses close-half plus break-even as one ordered compound management command', () => {
  assert.deepEqual(buildMachinePlan({ text: 'close half layers now and make sure BE' }), {
    status: 'MANAGEMENT',
    management: {
      type: 'COMPOUND',
      actions: [
        { type: 'CLOSE_PARTIAL', fraction: 0.5 },
        { type: 'MOVE_SL_TO_BE' },
      ],
    },
  });

  assert.deepEqual(buildMachinePlan({ text: 'BTCUSD close half and move SL to BE' }), {
    status: 'MANAGEMENT',
    management: {
      type: 'COMPOUND',
      actions: [
        { type: 'CLOSE_PARTIAL', fraction: 0.5 },
        { type: 'MOVE_SL_TO_BE' },
      ],
      symbol: { source: 'BTCUSD', canonical: 'BTCUSD' },
    },
  });
});

test('compound management expands into ordered broker actions on the same open position', () => {
  assert.deepEqual(buildManagementActions(openGroup(), {
    type: 'COMPOUND',
    actions: [
      { type: 'CLOSE_PARTIAL', fraction: 0.5 },
      { type: 'MOVE_SL_TO_BE' },
    ],
  }), [
    {
      type: 'CLOSE_PARTIAL',
      legId: 'leg-1',
      targetIndex: 1,
      brokerPositionId: 'position-1',
      symbol: 'BTCUSD',
      fraction: 0.5,
      lots: 0.01,
    },
    {
      type: 'MODIFY_POSITION',
      managementType: 'MOVE_SL_TO_BE',
      legId: 'leg-1',
      targetIndex: 1,
      brokerPositionId: 'position-1',
      symbol: 'BTCUSD',
      side: 'BUY',
      entryPrice: 77000,
      stopLoss: 77000,
    },
  ]);
});

test('single-action management remains backward compatible', () => {
  assert.deepEqual(buildMachinePlan({ text: 'CLOSE HALF' }), {
    status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 },
  });
  assert.deepEqual(buildMachinePlan({ text: 'MOVE SL TO BE' }), {
    status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' },
  });
});

test('compound management fans out across account-specific groups of one logical trade', async () => {
  const groups = new Map([
    ['group-a', openGroup({ id: 'group-a', tradeAccountId: 'acct-a', legs: [{ legId: 'leg-a', targetIndex: 1, lots: 0.02, status: 'OPEN', brokerPositionId: 'position-a' }] })],
    ['group-b', openGroup({ id: 'group-b', tradeAccountId: 'acct-b', legs: [{ legId: 'leg-b', targetIndex: 1, lots: 0.02, status: 'OPEN', brokerPositionId: 'position-b' }] })],
  ]);

  const result = await orchestrateTradingEventSimulation({
    event: {
      external_event_id: 'telegram:-1001:240',
      workspace_hint: 'workspace-1',
      source: { instance_id: 'listener-1' },
      thread: { reply_to_event_id: 'telegram:-1001:238' },
    },
    interpretation: {
      status: 'MANAGEMENT',
      management: {
        type: 'COMPOUND',
        actions: [
          { type: 'CLOSE_PARTIAL', fraction: 0.5 },
          { type: 'MOVE_SL_TO_BE' },
        ],
      },
    },
    eventId: 'db-compound',
    nowMs: 3000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupIds: ['group-a', 'group-b'] }) },
    stateStore: {
      getGroup: async (id) => structuredClone(groups.get(id) || null),
      putGroup: async (group) => group,
    },
    accountProvider: async () => [enabledAccount('acct-a'), enabledAccount('acct-b')],
    instrumentProvider: async () => { throw new Error('management must not require market metadata'); },
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts.length, 2);
  assert.ok(result.accounts.every((account) => account.status === 'READY'));
  assert.ok(result.accounts.every((account) => account.actions.length === 2));
  assert.deepEqual(result.accounts.map((account) => account.actions.map((action) => action.type)), [
    ['CLOSE_PARTIAL', 'MODIFY_POSITION'],
    ['CLOSE_PARTIAL', 'MODIFY_POSITION'],
  ]);
});

test('negated compound language still fails closed', () => {
  assert.equal(buildMachinePlan({ text: "don't close half and don't move SL to BE" }).status, 'NEEDS_INTERPRETATION');
});