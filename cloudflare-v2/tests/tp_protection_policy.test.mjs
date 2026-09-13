import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

function account(autoTpProtection = false) {
  return {
    id: 'acct-1', execution_enabled: true, sizingMode: 'FIXED_LOTS', fixedLots: 0.03,
    safety_policy: {
      enabled: true,
      killSwitch: false,
      allowedSymbols: ['XAUUSD'],
      maxLotsPerTrade: 1,
      autoTpProtection,
    },
  };
}

function group() {
  return {
    id: 'group-1', workspaceId: 'ws-1', tradeAccountId: 'acct-1', sourceInstanceId: 'listener-1',
    sourceEventIds: ['origin-1'], symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET',
    entryPrice: 2500, entry: { kind: 'PRICE', value: 2500 }, stopLoss: 2490,
    status: 'OPEN', incomplete: false, createdAt: 1000, updatedAt: 1000,
    legs: [
      { legId: 'leg-1', targetIndex: 1, lots: 0.03, stopLoss: 2490, takeProfit: 2510, status: 'OPEN', brokerPositionId: 'pos-1' },
      { legId: 'leg-2', targetIndex: 2, lots: 0.03, stopLoss: 2490, takeProfit: 2520, status: 'OPEN', brokerPositionId: 'pos-2' },
      { legId: 'leg-3', targetIndex: 3, lots: 0.03, stopLoss: 2490, takeProfit: 2530, status: 'OPEN', brokerPositionId: 'pos-3' },
    ],
  };
}

const event = {
  external_event_id: 'tp-hit-1', workspace_hint: 'ws-1', source: { instance_id: 'listener-1' }, thread: {},
};

test('secure profits means close half, while break-even phrases remain break-even', () => {
  assert.deepEqual(buildMachinePlan({ text: 'SECURE PROFITS' }), {
    status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 },
  });
  assert.deepEqual(buildMachinePlan({ text: 'MOVE SL TO BE' }), {
    status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' },
  });
  assert.deepEqual(buildMachinePlan({ text: 'RISK FREE' }), {
    status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' },
  });
});

test('TP hit is a correlatable management event instead of creating a new trade', () => {
  assert.deepEqual(buildMachinePlan({ text: 'TP1 HIT' }), {
    status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: 1 },
  });
});

test('automatic TP protection is disabled by default and emits no action', async () => {
  const result = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: 1 } },
    nowMs: 2000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: 'group-1' }) },
    stateStore: { getGroup: async () => structuredClone(group()), putGroup: async () => { throw new Error('disabled policy must not mutate state'); } },
    accountProvider: async () => [account(false)],
    instrumentProvider: async () => { throw new Error('target-hit protection must not require market metadata'); },
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'SKIPPED');
  assert.equal(result.accounts[0].reason, 'AUTO_TP_PROTECTION_DISABLED');
  assert.deepEqual(result.accounts[0].actions, []);
});

test('when enabled TP1 hit moves only remaining TP legs to TP1 price', async () => {
  let persisted;
  const result = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: 1 } },
    nowMs: 2000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: 'group-1' }) },
    stateStore: {
      getGroup: async () => structuredClone(group()),
      putGroup: async (value) => { persisted = structuredClone(value); return value; },
    },
    accountProvider: async () => [account(true)],
    instrumentProvider: async () => { throw new Error('target-hit protection must not require market metadata'); },
  });

  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions.map((action) => ({
    type: action.type,
    brokerPositionId: action.brokerPositionId,
    stopLoss: action.stopLoss,
    simulated: action.simulated,
  })), [
    { type: 'MODIFY_POSITION', brokerPositionId: 'pos-2', stopLoss: 2510, simulated: true },
    { type: 'MODIFY_POSITION', brokerPositionId: 'pos-3', stopLoss: 2510, simulated: true },
  ]);
  assert.equal(persisted.sourceEventIds.includes('tp-hit-1'), true);
});

test('when enabled TP2 hit moves only later remaining legs to TP2 price', async () => {
  const result = await orchestrateTradingEventSimulation({
    event: { ...event, external_event_id: 'tp-hit-2' },
    interpretation: { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: 2 } },
    nowMs: 2000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: 'group-1' }) },
    stateStore: { getGroup: async () => structuredClone(group()), putGroup: async (value) => value },
    accountProvider: async () => [account(true)],
    instrumentProvider: async () => { throw new Error('target-hit protection must not require market metadata'); },
  });

  assert.deepEqual(result.accounts[0].actions.map((action) => [action.brokerPositionId, action.stopLoss]), [
    ['pos-3', 2520],
  ]);
});

test('target-hit protection fails closed when target index does not exist', async () => {
  const result = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: 9 } },
    nowMs: 2000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: 'group-1' }) },
    stateStore: { getGroup: async () => structuredClone(group()), putGroup: async () => { throw new Error('invalid target must not mutate state'); } },
    accountProvider: async () => [account(true)],
    instrumentProvider: async () => { throw new Error('target-hit protection must not require market metadata'); },
  });

  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.equal(result.accounts[0].reason, 'MANAGEMENT_ACTION_INVALID');
  assert.deepEqual(result.accounts[0].actions, []);
});
