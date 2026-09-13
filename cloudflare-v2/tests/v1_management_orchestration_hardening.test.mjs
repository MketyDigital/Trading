import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

const event = {
  external_event_id: 'evt-management',
  workspace_hint: 'workspace-1',
  source: { instance_id: 'listener-1' },
  thread: { reply_to_event_id: 'evt-origin' },
};

function enabledAccount(overrides = {}) {
  return {
    id: 'acct-1',
    execution_enabled: true,
    sizingMode: 'FIXED_LOTS',
    fixedLots: 0.03,
    safety_policy: { enabled: true, killSwitch: false, allowedSymbols: ['XAUUSD'], maxLotsPerTrade: 1 },
    ...overrides,
  };
}

function plannedGroup(overrides = {}) {
  return {
    id: 'planned-group',
    tradeAccountId: 'acct-1',
    workspaceId: 'workspace-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['evt-origin'],
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 2500,
    entry: { kind: 'PRICE', value: 2500 },
    status: 'PLANNED',
    incomplete: false,
    legs: [
      { legId: 'leg-1', targetIndex: 1, lots: 0.03, status: 'PLANNED', stopLoss: 2490, takeProfit: 2510 },
      { legId: 'leg-2', targetIndex: 2, lots: 0.03, status: 'PLANNED', stopLoss: 2490, takeProfit: 2520 },
    ],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

async function run(management) {
  return orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management },
    eventId: 'db-management',
    nowMs: 3000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'planned-group' }) },
    stateStore: {
      getGroup: async () => structuredClone(plannedGroup()),
      putGroup: async (group) => group,
    },
    accountProvider: async () => [enabledAccount()],
    instrumentProvider: async () => { throw new Error('management must not require market metadata'); },
  });
}

test('planned-group explicit SL modification remains available through orchestration', async () => {
  const result = await run({ type: 'MOVE_SL', stopLoss: 2505 });
  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions, [
    { type: 'MODIFY_POSITION', legId: 'leg-1', targetIndex: 1, symbol: 'XAUUSD', stopLoss: 2505, simulated: true },
    { type: 'MODIFY_POSITION', legId: 'leg-2', targetIndex: 2, symbol: 'XAUUSD', stopLoss: 2505, simulated: true },
  ]);
});

test('planned-group indexed TP modification changes only the selected target through orchestration', async () => {
  const result = await run({ type: 'CHANGE_TP', targetIndex: 2, takeProfit: 2540 });
  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts[0].status, 'READY');
  assert.deepEqual(result.accounts[0].actions, [
    { type: 'MODIFY_POSITION', legId: 'leg-2', targetIndex: 2, symbol: 'XAUUSD', takeProfit: 2540, simulated: true },
  ]);
});

test('matched management never falls through to a different account', async () => {
  const result = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL', stopLoss: 2505 } },
    eventId: 'db-management-wrong-account',
    nowMs: 3000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'planned-group' }) },
    stateStore: {
      getGroup: async () => structuredClone(plannedGroup()),
      putGroup: async () => { throw new Error('wrong-account management must not mutate group state'); },
    },
    accountProvider: async () => [{ ...enabledAccount(), id: 'acct-2' }],
    instrumentProvider: async () => { throw new Error('management must not require market metadata'); },
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'MATCHED_ACCOUNT_NOT_FOUND');
  assert.deepEqual(result.accounts, []);
  assert.deepEqual(result.actions, []);
});

test('matched management fans out to every account-specific group for the same logical trade', async () => {
  const groups = new Map([
    ['group-a', plannedGroup({ id: 'group-a', tradeAccountId: 'acct-a', sourceEventIds: ['evt-origin'], legs: [{ legId: 'leg-a', targetIndex: 1, lots: 0.03, status: 'PLANNED' }] })],
    ['group-b', plannedGroup({ id: 'group-b', tradeAccountId: 'acct-b', sourceEventIds: ['evt-origin'], legs: [{ legId: 'leg-b', targetIndex: 1, lots: 0.03, status: 'PLANNED' }] })],
  ]);
  const persisted = [];
  const result = await orchestrateTradingEventSimulation({
    event,
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    eventId: 'db-management-multi',
    nowMs: 3000,
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'MATCHED', reason: 'REPLY_TARGET', groupIds: ['group-a', 'group-b'] }) },
    stateStore: {
      getGroup: async (id) => structuredClone(groups.get(id) || null),
      putGroup: async (group) => { persisted.push(structuredClone(group)); return group; },
    },
    accountProvider: async () => [
      enabledAccount({ id: 'acct-a' }),
      enabledAccount({ id: 'acct-b' }),
    ],
    instrumentProvider: async () => { throw new Error('management must not require market metadata'); },
  });

  assert.equal(result.status, 'SIMULATED');
  assert.equal(result.accounts.length, 2);
  assert.deepEqual(result.accounts.map((account) => account.accountId), ['acct-a', 'acct-b']);
  assert.ok(result.accounts.every((account) => account.status === 'READY'));
  assert.equal(persisted.length, 2);
});
