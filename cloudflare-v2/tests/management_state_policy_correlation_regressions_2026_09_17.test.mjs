import test from 'node:test';
import assert from 'node:assert/strict';

import { productionTradeStateBindingPayload } from '../src/state/production_trade_state_binder.js';
import { TradeStateStore } from '../src/state/trade_state_store.js';
import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';
import { evaluateBreakEvenEligibility } from '../src/execution/break_even_safety.js';
import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';
import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';
import { withUserAcceptanceControls } from '../src/dashboard_user_acceptance_controls.js';
import { buildExecutionPlan } from '../src/execution/execution_plan.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async list() { return new Map(values); },
  };
}

function activeGroup(overrides = {}) {
  return {
    id: 'g1', workspaceId: 'ws', tradeAccountId: 'a1', sourceInstanceId: 'src',
    sourceEventIds: ['telegram:-1001:100'], symbol: 'EURUSD', side: 'BUY', orderType: 'MARKET',
    entryPrice: 1.1476, status: 'OPEN', createdAt: 1000, updatedAt: 1000,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.01, status: 'OPEN', brokerPositionId: 'p1' }],
    ...overrides,
  };
}

test('production binding payload carries final protection state and explicit clears', () => {
  assert.deepEqual(productionTradeStateBindingPayload({
    actionType: 'MODIFY_POSITION', stopLoss: 1.1490, takeProfit: 1.1300,
  }), {
    actionType: 'MODIFY_POSITION', status: 'OPEN', stopLoss: 1.1490, takeProfit: 1.1300,
  });
  assert.deepEqual(productionTradeStateBindingPayload({
    actionType: 'MODIFY_POSITION', clearStopLoss: true, takeProfit: 1.1300,
  }), {
    actionType: 'MODIFY_POSITION', status: 'OPEN', takeProfit: 1.1300, clearStopLoss: true,
  });
});

test('durable MODIFY_POSITION state keeps sequential SL then TP instead of losing the sibling protection', async () => {
  const store = new TradeStateStore(memoryStorage());
  await store.putGroup(activeGroup());
  await store.bindLegExecution('g1', 'leg-1', {
    actionType: 'MODIFY_POSITION', stopLoss: 1.1490,
  }, 2000);
  await store.bindLegExecution('g1', 'leg-1', {
    actionType: 'MODIFY_POSITION', takeProfit: 1.1300,
  }, 3000);
  const saved = await store.getGroup('g1');
  assert.equal(saved.legs[0].stopLoss, 1.1490);
  assert.equal(saved.legs[0].takeProfit, 1.1300);
});

test('durable protection clear nulls only the requested field and preserves the sibling', async () => {
  const store = new TradeStateStore(memoryStorage());
  await store.putGroup(activeGroup({
    stopLoss: 1.14,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.01, status: 'OPEN', brokerPositionId: 'p1', stopLoss: 1.14, takeProfit: 1.16 }],
  }));
  await store.bindLegExecution('g1', 'leg-1', {
    actionType: 'MODIFY_POSITION', clearStopLoss: true, takeProfit: 1.16,
  }, 2000);
  const saved = await store.getGroup('g1');
  assert.equal(saved.legs[0].stopLoss, null);
  assert.equal(saved.legs[0].takeProfit, 1.16);
  assert.equal(saved.stopLoss, null);
});

test('successful MODIFY_POSITION binds desired protection even when broker response has no fresh ids or fill', async () => {
  const bindings = [];
  const result = await executeProductionPlan({
    workspaceId: 'ws', eventId: 'evt', brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: false, liveBrokerExecutionControlAvailable: true,
    accountPlans: [{
      accountId: 'a1', groupId: 'g1', actions: [{
        type: 'MODIFY_POSITION', legId: 'leg-1', brokerPositionId: 'p1', symbol: 'EURUSD',
        stopLoss: 1.1490, takeProfit: 1.1300, idempotencyKey: 'k1',
      }],
    }],
  }, {
    accountLoader: async () => ({
      id: 'a1', workspace_id: 'ws', environment: 'demo', is_active: true, execution_enabled: true,
      safety_policy: { enabled: true, killSwitch: false },
    }),
    dispatchAction: async () => ({ ok: true }),
    stateBinder: async (binding) => bindings.push(binding),
  });
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].actionType, 'MODIFY_POSITION');
  assert.equal(bindings[0].stopLoss, 1.1490);
  assert.equal(bindings[0].takeProfit, 1.1300);
});

test('BE is eligible for any real profit beyond entry, even a very small move', () => {
  assert.equal(evaluateBreakEvenEligibility({ side: 'BUY', entryPrice: 1.10000, marketPrice: 1.10001 }).allowed, true);
  assert.equal(evaluateBreakEvenEligibility({ side: 'SELL', entryPrice: 1.10000, marketPrice: 1.09999 }).allowed, true);
  assert.equal(evaluateBreakEvenEligibility({ side: 'BUY', entryPrice: 1.10000, marketPrice: 1.10000 }).allowed, false);
});

test('no-reply management targets a clearly fresh newest trade when older trades were opened long before it', () => {
  const groups = [
    activeGroup({ id: 'old-gold', symbol: 'XAUUSD', sourceEventIds: ['telegram:-1001:100'], createdAt: 1000, updatedAt: 9900 }),
    activeGroup({ id: 'new-eurusd', symbol: 'EURUSD', sourceEventIds: ['telegram:-1001:200'], createdAt: 9000, updatedAt: 9000 }),
  ];
  assert.deepEqual(correlateTradingEvent({
    event: { workspace_hint: 'ws', source: { instance_id: 'src' }, external_event_id: 'telegram:-1001:300', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: groups, nowMs: 10000, correlationWindowMs: 120000,
  }), { status: 'MATCHED', reason: 'RECENT_ACTIVE_TRADE', groupId: 'new-eurusd' });
});

test('no-reply management fails closed when two distinct trades were opened within the same short interval', () => {
  const groups = [
    activeGroup({ id: 'gold', symbol: 'XAUUSD', sourceEventIds: ['telegram:-1001:100'], createdAt: 7000, updatedAt: 7000 }),
    activeGroup({ id: 'eurusd', symbol: 'EURUSD', sourceEventIds: ['telegram:-1001:200'], createdAt: 10000, updatedAt: 10000 }),
  ];
  assert.deepEqual(correlateTradingEvent({
    event: { workspace_hint: 'ws', source: { instance_id: 'src' }, external_event_id: 'telegram:-1001:300', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: groups, nowMs: 12000, correlationWindowMs: 120000,
  }), { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' });
});

test('no-reply recency uses trade opening time rather than later SL/TP updates on an old trade', () => {
  const groups = [
    activeGroup({ id: 'old-gold', symbol: 'XAUUSD', sourceEventIds: ['telegram:-1001:100'], createdAt: 1000, updatedAt: 11900 }),
    activeGroup({ id: 'new-eurusd', symbol: 'EURUSD', sourceEventIds: ['telegram:-1001:200'], createdAt: 10000, updatedAt: 10000 }),
  ];
  assert.deepEqual(correlateTradingEvent({
    event: { workspace_hint: 'ws', source: { instance_id: 'src' }, external_event_id: 'telegram:-1001:300', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: groups, nowMs: 12000, correlationWindowMs: 120000,
  }), { status: 'MATCHED', reason: 'RECENT_ACTIVE_TRADE', groupId: 'new-eurusd' });
});

test('no-reply management still matches one unique logical trade across multiple broker accounts', () => {
  const groups = [
    activeGroup({ id: 'ct', tradeAccountId: 'ctrader', sourceEventIds: ['telegram:-1001:100'] }),
    activeGroup({ id: 'mt', tradeAccountId: 'mt5', sourceEventIds: ['telegram:-1001:100'] }),
  ];
  assert.deepEqual(correlateTradingEvent({
    event: { workspace_hint: 'ws', source: { instance_id: 'src' }, external_event_id: 'telegram:-1001:300', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: groups, nowMs: 10000,
  }), { status: 'MATCHED', reason: 'ONLY_ACTIVE_TRADE', groupIds: ['ct', 'mt'] });
});

test('multiple replies to the same original signal continue matching the same logical trade', () => {
  const groups = [
    activeGroup({ id: 'ct', tradeAccountId: 'ctrader', sourceEventIds: ['telegram:-1001:100', 'telegram:-1001:101'] }),
    activeGroup({ id: 'mt', tradeAccountId: 'mt5', sourceEventIds: ['telegram:-1001:100', 'telegram:-1001:101'] }),
  ];
  for (const eventId of ['telegram:-1001:102', 'telegram:-1001:103']) {
    assert.deepEqual(correlateTradingEvent({
      event: { workspace_hint: 'ws', source: { instance_id: 'src' }, external_event_id: eventId, thread: { reply_to_event_id: 'telegram:-1001:100' } },
      interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } },
      activeGroups: groups,
    }), { status: 'MATCHED', reason: 'REPLY_TARGET', groupIds: ['ct', 'mt'] });
  }
});

test('real enterprise account frontend exposes auto TP and entry-zone controls while fast entry is visibly always on without a toggle', () => {
  const html = withUserAcceptanceControls(renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' }));
  assert.match(html, /data-account-auto-tp-protection/);
  assert.match(html, /data-entry-zone-select/);
  assert.match(html, /Fast entry/);
  assert.match(html, /Always on/);
  assert.equal(html.includes('data-action="account-fast-entry"'), false);
  assert.match(html, /\/entry-zone-policy/);
});

test('entry-zone policy mode is honored for range execution', () => {
  const intent = {
    side: 'BUY', orderType: 'LIMIT', symbol: { canonical: 'EURUSD' },
    entry: { kind: 'RANGE', min: 1.10, max: 1.11 }, stopLoss: 1.09, takeProfits: [1.12], fastEntry: false, incomplete: false,
  };
  const plan = buildExecutionPlan(intent, {
    account: {
      sizingMode: 'FIXED_LOTS', fixedLots: 0.01,
      safetyPolicy: { enabled: true, killSwitch: false },
      entryZonePolicy: { mode: 'market_if_inside' },
    },
    instrument: { stepLots: 0.01, minLots: 0.01, maxLots: 10 }, currentMarketPrice: 1.105, groupId: 'g-zone',
  });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.actions[0].orderType, 'MARKET');
  assert.equal(plan.actions[0].entry.kind, 'MARKET');
});

test('fast entry executes immediately even when a legacy account row still carries a wait policy', async () => {
  const stored = [];
  const result = await orchestrateTradingEventSimulation({
    event: { external_event_id: 'telegram:-1001:500', workspace_hint: 'ws', source: { instance_id: 'src' }, thread: {} },
    eventId: 'evt-fast',
    interpretation: {
      status: 'READY',
      intent: {
        side: 'BUY', orderType: 'MARKET', symbol: { canonical: 'EURUSD' }, entry: { kind: 'MARKET' },
        stopLoss: null, takeProfits: [], fastEntry: true, incomplete: true,
      },
    },
  }, {
    stateCoordinator: { correlate: async () => ({ status: 'NEW_GROUP' }) },
    stateStore: { putGroup: async (group) => stored.push(group), getGroup: async () => null },
    accountProvider: async () => [{
      id: 'a1', workspace_id: 'ws', execution_enabled: true, sizingMode: 'FIXED_LOTS', fixedLots: 0.01,
      safety_policy: { enabled: true, killSwitch: false }, fast_entry_policy: { mode: 'wait_for_complete_signal' },
    }],
    instrumentProvider: async () => ({ stepLots: 0.01, minLots: 0.01, maxLots: 10 }),
    marketPriceProvider: async () => 1.1,
  });
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].actions[0].type, 'OPEN_POSITION');
  assert.equal(stored.length, 1);
});
