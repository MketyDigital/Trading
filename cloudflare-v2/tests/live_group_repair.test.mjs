import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveRepairDecision, repairLivePositionGroup, selectCompletedRepairEvent } from '../src/execution/live_group_repair.js';

const group = {
  id: 'g1',
  side: 'SELL',
  entryPrice: 4346.15,
  entry: { kind: 'MARKET', executedPrice: 4346.15 },
  stopLoss: 4359.5,
};
const intent = {
  side: 'SELL',
  stopLoss: 4359.5,
  takeProfits: [4341.5, 4335.5, 4315.5],
};

test('live repair before TP1 restores original SL and all targets remain outstanding', () => {
  const result = buildLiveRepairDecision({ group, intent, marketPrice: 4348, lotValue: 0.01 });
  assert.equal(result.ok, true);
  assert.equal(result.passedCount, 0);
  assert.equal(result.protectionStop, 4359.5);
});

test('live repair after TP1 uses break-even and treats TP1 as already passed', () => {
  const result = buildLiveRepairDecision({ group, intent, marketPrice: 4339, lotValue: 0.01 });
  assert.equal(result.ok, true);
  assert.equal(result.passedCount, 1);
  assert.equal(result.protectionStop, 4346.15);
});

test('live repair after TP2 locks remaining risk at TP1', () => {
  const result = buildLiveRepairDecision({ group, intent, marketPrice: 4330, lotValue: 0.01 });
  assert.equal(result.ok, true);
  assert.equal(result.passedCount, 2);
  assert.equal(result.protectionStop, 4341.5);
});

test('live repair refuses a SELL whose live close-side price has reached the stop', () => {
  const result = buildLiveRepairDecision({ group, intent, marketPrice: 4360, lotValue: 0.01 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SIGNAL_STOP_ALREADY_INVALIDATED');
});

test('BUY repair mirrors target and stop geometry correctly', () => {
  const buyGroup = { id: 'g2', side: 'BUY', entryPrice: 100, entry: { executedPrice: 100 }, stopLoss: 95 };
  const buyIntent = { side: 'BUY', stopLoss: 95, takeProfits: [105, 110, 120] };
  const afterTp2 = buildLiveRepairDecision({ group: buyGroup, intent: buyIntent, marketPrice: 112, lotValue: 0.01 });
  assert.equal(afterTp2.ok, true);
  assert.equal(afterTp2.passedCount, 2);
  assert.equal(afterTp2.protectionStop, 105);
  assert.equal(buildLiveRepairDecision({ group: buyGroup, intent: buyIntent, marketPrice: 94, lotValue: 0.01 }).reason, 'SIGNAL_STOP_ALREADY_INVALIDATED');
});


test('live repair chooses the completed full signal over the original fast-entry event', () => {
  const fast = {
    id: 'fast-db',
    external_event_id: 'telegram:-1001:952',
    created_at: '2026-09-21T12:54:00Z',
    canonical_intent: {
      side: 'SELL',
      symbol: { canonical: 'XAUUSD' },
      incomplete: true,
      stopLoss: null,
      takeProfits: [],
    },
  };
  const full = {
    id: 'full-db',
    external_event_id: 'telegram:-1001:953',
    created_at: '2026-09-21T12:55:00Z',
    canonical_intent: {
      side: 'SELL',
      symbol: { canonical: 'XAUUSD' },
      incomplete: false,
      stopLoss: 4371,
      takeProfits: [4353, 4347, 4327],
    },
  };

  assert.equal(selectCompletedRepairEvent([fast, full])?.id, 'full-db');
  assert.equal(selectCompletedRepairEvent([full, fast])?.id, 'full-db');
  assert.equal(selectCompletedRepairEvent([fast]), null);
});

test('live repair resolves authority data without constructing or using Supabase', async () => {
  const calls = [];
  const persistenceRuntime = {
    runtimeControls: {
      async getTradingAccessEnabled() { return { ok: true, enabled: true }; },
      async getBrokerExecutionEnabled() { return { ok: true, enabled: true }; },
      async getLiveBrokerExecutionEnabled() { return { ok: true, enabled: true }; },
    },
    tradeState: { async loadGroup(workspaceId, groupId) { calls.push(['group', workspaceId, groupId]); return { id: 'runtime-g1', workspaceId, tradeAccountId: 'a1', sourceEventId: 'e1', sourceEventIds: [], symbol: 'EURUSD', side: 'BUY' }; } },
    accounts: { async listAccounts(workspaceId) { calls.push(['accounts', workspaceId]); return [{ id: 'a1', environment: 'demo', platform: 'mt5', provider_mode: 'mt5_connector' }]; } },
    ingest: { eventStore: { async getById(workspaceId, id) { calls.push(['event', workspaceId, id]); return { id, canonical_intent: { symbol: { canonical: 'EURUSD' }, side: 'BUY', stopLoss: 1, takeProfits: [2] } }; }, async findByExternalEventId() { return null; } } },
  };
  const result = await repairLivePositionGroup({ env: {}, persistenceRuntime, workspaceId: 'ws1', groupId: 'runtime-g1', confirmLive: true });
  assert.equal(result.reason, 'REPAIR_PROVIDER_NOT_SUPPORTED');
  assert.deepEqual(calls.map(call => call[0]), ['group', 'accounts', 'event']);
});
