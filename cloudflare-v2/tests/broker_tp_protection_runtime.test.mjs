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
