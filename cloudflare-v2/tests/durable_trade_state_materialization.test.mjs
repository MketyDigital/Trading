import test from 'node:test';
import assert from 'node:assert/strict';

import { createV1SimulationDependencies } from '../src/pipeline/v1_simulation_deps.js';
import { createProductionTradeStateBinder } from '../src/state/production_trade_state_binder.js';

function recorderSupabase(seen) {
  return {
    from(table) {
      return {
        async upsert(rows, options = {}) {
          seen.push({ table, rows: structuredClone(rows), options: structuredClone(options) });
          return { data: rows, error: null };
        },
      };
    },
  };
}

function stateNamespace(responseFactory) {
  return {
    idFromName(name) { return `do:${name}`; },
    get() {
      return {
        async fetch(url, options) {
          return responseFactory(String(url), options);
        },
      };
    },
  };
}

function plannedGroup(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tradeAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sourceEventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sourceInstanceId: 'normalized-source-instance',
    sourceEventIds: ['source:event:1'],
    threadId: 'thread-1',
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entry: { kind: 'MARKET' },
    stopLoss: 4300,
    status: 'PLANNED',
    incomplete: false,
    positionMode: 'HEDGED',
    riskPlan: { mode: 'FIXED_LOTS' },
    policySnapshot: { allowed: true },
    createdAt: 1789389000000,
    updatedAt: 1789389000000,
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0.01,
      stopLoss: 4300,
      takeProfit: 4320,
      status: 'PLANNED',
    }],
    ...overrides,
  };
}

test('planning a canonical group mirrors the group and legs to Supabase before broker execution', async () => {
  const seen = [];
  const group = plannedGroup();
  const env = {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
    TRADE_STATE_NAMESPACE: stateNamespace((_url, options) => new Response(options.body, {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })),
  };
  const deps = await createV1SimulationDependencies({
    env,
    supabase: recorderSupabase(seen),
    event: { workspace_hint: group.workspaceId },
    sourceId: 'source-1',
  });

  await deps.stateStore.putGroup(group);

  assert.deepEqual(seen.map((call) => call.table), ['position_groups', 'position_legs']);
  assert.equal(seen[0].rows.id, group.id);
  assert.equal(seen[0].rows.workspace_id, group.workspaceId);
  assert.equal(seen[0].rows.trade_account_id, group.tradeAccountId);
  assert.equal(seen[0].rows.canonical_symbol, 'XAUUSD');
  assert.equal(seen[1].rows[0].position_group_id, group.id);
  assert.equal(seen[1].rows[0].state_leg_id, 'leg-1');
  assert.equal(seen[1].rows[0].requested_lots, 0.01);
});

test('successful production lifecycle binding mirrors the canonical post-bind state to Supabase', async () => {
  const seen = [];
  const bound = plannedGroup({
    status: 'OPEN',
    updatedAt: 1789389060000,
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0.05,
      stopLoss: 4300,
      takeProfit: 4320,
      status: 'OPEN',
      brokerPositionId: 'position-99',
      brokerOrderId: 'order-88',
      brokerDealId: 'deal-77',
      fillPrice: 4315.13,
      executedLots: 0.05,
      volumeStepLots: 0.05,
      minimumLots: 0.05,
      actionType: 'OPEN_POSITION',
    }],
  });
  const env = {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
    TRADE_STATE_NAMESPACE: stateNamespace(() => new Response(JSON.stringify(bound), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
  };
  const binder = createProductionTradeStateBinder({
    env,
    supabase: recorderSupabase(seen),
    workspaceId: bound.workspaceId,
  });

  await binder({
    workspaceId: bound.workspaceId,
    eventId: bound.sourceEventId,
    accountId: bound.tradeAccountId,
    groupId: bound.id,
    legId: 'leg-1',
    actionType: 'OPEN_POSITION',
    brokerPositionId: 'position-99',
    brokerOrderId: 'order-88',
    brokerDealId: 'deal-77',
    fillPrice: 4315.13,
    executedLots: 0.05,
    volumeStepLots: 0.05,
    minimumLots: 0.05,
  });

  assert.deepEqual(seen.map((call) => call.table), ['position_groups', 'position_legs']);
  assert.equal(seen[0].rows.status, 'OPEN');
  assert.equal(seen[1].rows[0].broker_position_id, 'position-99');
  assert.equal(seen[1].rows[0].broker_order_id, 'order-88');
  assert.equal(seen[1].rows[0].broker_deal_id, 'deal-77');
  assert.equal(seen[1].rows[0].executed_lots, 0.05);
  assert.equal(seen[1].rows[0].remaining_lots, 0.05);
});
