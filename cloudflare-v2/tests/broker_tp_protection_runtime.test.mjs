import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrokerTpProtectionRuntime } from '../src/execution/broker_tp_protection_runtime.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';
import { TradeStateCoordinator } from '../src/state/trade_state_store.js';

const candidate = { workspaceId: 'w1', tradeAccountId: 'a1', groupId: 'g1', legId: 'l1', targetIndex: 1,
  brokerPositionId: 'p1', lots: 1, takeProfit: 1.12, stopLoss: 1.1 };
const account = { id: 'a1', workspace_id: 'w1', account_id: '123', platform: 'mt5', environment: 'live',
  is_active: true, execution_enabled: true, safety_policy: { autoTpProtection: true } };
const snapshot = { accountId: '123', positionId: 'p1', environment: 'live', isLive: true, isOpen: false,
  initialLots: 1, closedLots: 1, deals: [{ dealId: 'd1', positionId: 'p1', lots: 1, entry: 'OUT', reason: 'TP' }] };

function runtime(overrides = {}) {
  const calls = { reads: 0, records: 0, applies: 0 };
  const run = createBrokerTpProtectionRuntime({
    loadCandidates: async () => [candidate], loadAccount: async () => account,
    readPositionCloseStatus: async () => { calls.reads++; return snapshot; },
    loadSourceEvent: async () => ({ sourceId: 's1', sourceInstanceId: 'si1', metadata: {} }),
    recordManagementEvent: async () => { calls.records++; return { eventId: 'event-1' }; },
    applyTargetHit: async ({ candidate: row, detection, event }) => {
      calls.applies++; assert.equal(row.groupId, 'g1'); assert.equal(detection.status, 'TP_CONFIRMED');
      assert.equal(event.eventId, 'event-1'); return { simulation: { status: 'SIMULATED' } };
    }, clock: () => 1234, ...overrides,
  });
  return { run, calls };
}

test('confirmed TP is handed to the existing management orchestrator with a stable event record', async () => {
  const { run, calls } = runtime();
  const result = await run({});
  assert.deepEqual(result, { status: 'ok', scanned: 1, confirmed: 1, applied: 1, skipped: 0, failed: 0 });
  assert.deepEqual(calls, { reads: 1, records: 1, applies: 1 });
});

test('manual open-position SL/TP edits are emitted once through the existing management path', async () => {
  let records = 0; let applies = 0; let snapshots = 0;
  const { run } = runtime({
    readPositionCloseStatus: async () => ({ ...snapshot, isOpen: true, closedLots: 0, deals: [] }),
    readPositionStatus: async () => { snapshots++; return { accountId: '123', positionId: 'p1', environment: 'live', isLive: true, isOpen: true, symbol: 'EURUSD', side: 'BUY', stopLoss: 1.105, takeProfit: 1.125 }; },
    recordProtectionEvent: async ({ protection }) => { records++; assert.equal(protection.status, 'PROTECTION_CHANGED'); return { eventId: 'protection-1' }; },
    applyProtectionChange: async ({ protection }) => { applies++; assert.deepEqual(protection.actions, [{ type: 'MOVE_SL', stopLoss: 1.105, targetIndex: 1 }, { type: 'CHANGE_TP', takeProfit: 1.125, targetIndex: 1 }]); return { execution: { status: 'SUCCEEDED' } }; },
  });
  const result = await run({});
  assert.equal(result.protections, 1);
  assert.equal(snapshots, 1);
  assert.equal(records, 1);
  assert.equal(applies, 1);
});

test('a broker-missing stop is restored from valid stored protection instead of mirrored as removal', async () => {
  const observations = [];
  let applied = null;
  const { run } = runtime({
    readPositionCloseStatus: async () => ({ ...snapshot, isOpen: true, closedLots: 0, deals: [] }),
    readPositionStatus: async () => ({ accountId: '123', positionId: 'p1', environment: 'live', isLive: true,
      isOpen: true, symbol: 'EURUSD', side: 'BUY', stopLoss: null, takeProfit: 1.12 }),
    recordObservation: async (value) => observations.push(value),
    recordProtectionEvent: async ({ protection }) => { applied = protection; return { eventId: 'restore-missing-stop' }; },
    applyProtectionChange: async () => ({ execution: { status: 'SUCCEEDED' } }),
  });
  const result = await run({});
  assert.equal(result.protections, 1);
  assert.deepEqual(applied.actions, [{ type: 'MOVE_SL', stopLoss: 1.1, targetIndex: 1 }]);
  const synced = observations.at(-1);
  assert.equal(synced.status, 'PROTECTION_SYNCED');
  assert.equal(Object.hasOwn(synced, 'stopLoss'), false);
  assert.equal(Object.hasOwn(synced, 'takeProfit'), false);
});

test('an unchanged broker protection fingerprint is not re-applied on later snapshots', async () => {
  let records = 0; let applies = 0;
  const fingerprint = 'p1|1.105|1.125';
  const { run } = runtime({
    loadCandidates: async () => [{ ...candidate, lastBrokerStatus: 'PROTECTION_SYNCED', lastBrokerSnapshotFingerprint: fingerprint }],
    readPositionCloseStatus: async () => ({ ...snapshot, isOpen: true, closedLots: 0, deals: [] }),
    readPositionStatus: async () => ({ accountId: '123', positionId: 'p1', environment: 'live', isLive: true,
      isOpen: true, symbol: 'EURUSD', side: 'BUY', stopLoss: 1.105, takeProfit: 1.125 }),
    recordProtectionEvent: async () => { records++; return { eventId: 'duplicate-protection' }; },
    applyProtectionChange: async () => { applies++; return { execution: { status: 'SUCCEEDED' } }; },
  });
  const result = await run({});
  assert.equal(result.protections || 0, 0);
  assert.equal(records, 0);
  assert.equal(applies, 0);
});

test('a one-sided protection edit persists only the changed valid protection value', async () => {
  const observations = [];
  const { run } = runtime({
    readPositionCloseStatus: async () => ({ ...snapshot, isOpen: true, closedLots: 0, deals: [] }),
    readPositionStatus: async () => ({ accountId: '123', positionId: 'p1', environment: 'live', isLive: true,
      isOpen: true, symbol: 'EURUSD', side: 'BUY', stopLoss: 1.105, takeProfit: Number.NaN }),
    recordObservation: async (value) => observations.push(value),
    recordProtectionEvent: async () => ({ eventId: 'protection-one-sided' }),
    applyProtectionChange: async () => ({ execution: { status: 'SUCCEEDED' } }),
  });
  await run({});
  const protectionObservation = observations.find((value) => value.status === 'PROTECTION_SYNCED');
  assert.equal(protectionObservation.stopLoss, 1.105);
  assert.equal(Object.hasOwn(protectionObservation, 'takeProfit'), false);
  assert.equal(observations[0].status, 'PROTECTION_PENDING');
});

test('failed follower propagation leaves the broker protection change pending for retry', async () => {
  const observations = [];
  let applies = 0;
  const { run } = runtime({
    readPositionCloseStatus: async () => ({ ...snapshot, isOpen: true, closedLots: 0, deals: [] }),
    readPositionStatus: async () => ({ accountId: '123', positionId: 'p1', environment: 'live', isLive: true,
      isOpen: true, symbol: 'EURUSD', side: 'BUY', stopLoss: 1.105, takeProfit: 1.125 }),
    recordObservation: async (value) => observations.push(value),
    recordProtectionEvent: async () => ({ eventId: 'protection-retry' }),
    applyProtectionChange: async () => { applies++; return { execution: { status: 'FAILED' } }; },
  });
  await run({});
  assert.equal(applies, 1);
  const saved = observations.at(-1);
  assert.equal(saved.status, 'PROTECTION_PENDING');
  assert.equal(saved.snapshotFingerprint ?? null, null);
  assert.equal(Object.hasOwn(saved, 'stopLoss'), false);
  await run({});
  assert.equal(applies, 2);
});

test('does not poll or act when the runtime is explicitly disabled', async () => {
  const { run, calls } = runtime();
  assert.deepEqual(await run({ BROKER_TP_PROTECTION_ENABLED: 'false' }),
    { status: 'disabled', scanned: 0, confirmed: 0, applied: 0, skipped: 0 });
  assert.deepEqual(calls, { reads: 0, records: 0, applies: 0 });
});

test('account policy, status identity, and broker close classification gate progression', async () => {
  const inactive = runtime({ loadAccount: async () => ({ ...account, is_active: false }) });
  assert.equal((await inactive.run({})).skipped, 1);
  assert.equal(inactive.calls.reads, 0);

  const mismatch = runtime({ readPositionCloseStatus: async () => ({ ...snapshot, accountId: 'other' }) });
  assert.equal((await mismatch.run({})).skipped, 1);
  assert.equal(mismatch.calls.records, 0);

  const stopLoss = runtime({ readPositionCloseStatus: async () => ({ ...snapshot,
    deals: [{ ...snapshot.deals[0], reason: 'SL' }] }) });
  assert.equal((await stopLoss.run({})).skipped, 1);
  assert.equal(stopLoss.calls.applies, 0);
});

test('detected TP1 and TP2 fills reach the existing stop progression planner', async () => {
  let group = { id: 'g1', workspaceId: 'w1', tradeAccountId: 'a1', status: 'OPEN', symbol: 'EURUSD', side: 'BUY',
    orderType: 'MARKET', entryPrice: 1.1, sourceInstanceId: 'source-1', sourceEventIds: ['signal-1'],
    legs: [
      { legId: 'l1', targetIndex: 1, logicalTargetIndex: 1, status: 'OPEN', lots: 0.1, brokerPositionId: 'p1', takeProfit: 1.12, stopLoss: 1.09 },
      { legId: 'l2', targetIndex: 2, logicalTargetIndex: 2, status: 'OPEN', lots: 0.1, brokerPositionId: 'p2', takeProfit: 1.14, stopLoss: 1.09 },
      { legId: 'l3', targetIndex: 3, logicalTargetIndex: 3, status: 'OPEN', lots: 0.1, brokerPositionId: 'p3', takeProfit: 1.16, stopLoss: 1.09 },
    ] };
  const stateStore = {
    async getGroup(id) { return id === group.id ? group : null; },
    async putGroup(next) { group = next; return next; },
    async listActive() { return [group]; },
  };
  const stateCoordinator = new TradeStateCoordinator(stateStore);
  const accountProvider = async () => [{ id: 'a1', workspace_id: 'w1', execution_enabled: true,
    safetyPolicy: { enabled: true, killSwitch: false, autoTpProtection: true } }];
  async function targetHit(positionId, targetIndex) {
    return orchestrateTradingEventSimulation({
      event: { workspace_hint: 'w1', source: { instance_id: 'source-1' }, external_event_id: `broker-fill-${positionId}` },
      interpretation: { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex, brokerPositionId: positionId } },
      eventId: `event-${positionId}`, nowMs: 1770000010000,
    }, { stateCoordinator, stateStore, accountProvider, instrumentProvider: async () => ({}) });
  }

  const tp1 = await targetHit('p1', 1);
  assert.deepEqual(tp1.accounts[0].actions.map((action) => [action.brokerPositionId, action.stopLoss]), [['p2', 1.1], ['p3', 1.1]]);
  assert.equal(group.legs[0].status, 'CLOSED');
  group.legs[1].stopLoss = 1.1;
  group.legs[2].stopLoss = 1.1;

  const tp2 = await targetHit('p2', 2);
  assert.deepEqual(tp2.accounts[0].actions.map((action) => [action.brokerPositionId, action.stopLoss]), [['p3', 1.12]]);
  assert.equal(group.legs[1].status, 'CLOSED');
});

test('polls every due open leg in a group so fast and completed legs both receive snapshots', async () => {
  const reads = [];
  const { run } = runtime({
    loadCandidates: async () => [
      { ...candidate, legId: 'l3', targetIndex: 3, brokerPositionId: 'p3', takeProfit: 1.16 },
      { ...candidate, legId: 'l1', targetIndex: 1, brokerPositionId: 'p1', takeProfit: 1.12 },
      { ...candidate, legId: 'l2', targetIndex: 2, brokerPositionId: 'p2', takeProfit: 1.14 },
    ],
    readPositionCloseStatus: async ({ candidate: row }) => {
      reads.push(row.legId);
      return { ...snapshot, positionId: row.brokerPositionId, isOpen: true, closedLots: 0, deals: [] };
    },
  });

  const result = await run({});
  assert.deepEqual(reads, ['l1', 'l2', 'l3']);
  assert.equal(result.scanned, 3);
  assert.equal(result.skipped, 3);
});

test('reports the broker classification for every observed next target without blocking protection', async () => {
  const observations = [];
  const { run } = runtime({
    readPositionCloseStatus: async () => ({ ...snapshot, isOpen: true, closedLots: 0, deals: [] }),
    recordObservation: async (observation) => { observations.push(observation); },
  });

  const result = await run({});
  assert.equal(result.skipped, 1);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].candidate.legId, 'l1');
  assert.equal(observations[0].status, 'UNRESOLVED');
  assert.equal(observations[0].reason, 'BROKER_POSITION_IDENTITY_MISMATCH');
});

test('bounds the default minute scan so broker history polling cannot overrun the cron', async () => {
  const candidates = Array.from({ length: 51 }, (_, index) => ({
    ...candidate,
    groupId: `g-${String(index).padStart(2, '0')}`,
    legId: `l-${index}`,
    brokerPositionId: String(1000 + index),
  }));
  const { run } = runtime({
    loadCandidates: async () => candidates,
    readPositionCloseStatus: async ({ candidate: row }) => ({
      ...snapshot,
      positionId: row.brokerPositionId,
      isOpen: true,
      closedLots: 0,
      deals: [],
    }),
  });

  const result = await run({});
  assert.equal(result.scanned, 50);
});

test('passes the current minute as the database page seed so rotation happens before any loader cap', async () => {
  let options;
  const { run } = runtime({
    loadCandidates: async (input) => { options = input; return []; },
    clock: () => 4 * 60_000,
  });

  await run({});
  assert.deepEqual(options, { limit: 50, pageSeed: 4, observationDueBefore: '1970-01-01T00:03:00.000Z' });
});

test('enforces a hard sixty-second minimum snapshot interval', async () => {
  let options;
  const { run } = runtime({
    loadCandidates: async (input) => { options = input; return []; },
    clock: () => 120_000,
  });
  await run({ BROKER_POSITION_SNAPSHOT_INTERVAL_MS: '1000' });
  assert.equal(options.observationDueBefore, '1970-01-01T00:01:00.000Z');
});
