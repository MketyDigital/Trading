import test from 'node:test';
import assert from 'node:assert/strict';

import { materializeTradeStateGroup } from '../src/state/supabase_trade_state_materializer.js';

function fakeSupabase() {
  const groups = [];
  const legs = [];
  const calls = [];

  function tableApi(table) {
    return {
      upsert(payload, options = {}) {
        const rows = Array.isArray(payload) ? payload : [payload];
        calls.push({ table, rows: structuredClone(rows), options: structuredClone(options) });
        if (table === 'position_groups') {
          const row = rows[0];
          const existing = groups.find((item) => item.workspace_id === row.workspace_id && item.runtime_group_id === row.runtime_group_id);
          const saved = existing
            ? Object.assign(existing, structuredClone(row))
            : Object.assign({ id: '11111111-1111-4111-8111-111111111111' }, structuredClone(row));
          if (!existing) groups.push(saved);
          return {
            select() { return this; },
            async maybeSingle() { return { data: structuredClone(saved), error: null }; },
          };
        }
        if (table === 'position_legs') {
          for (const row of rows) {
            const existing = legs.find((item) => item.position_group_id === row.position_group_id && item.runtime_leg_id === row.runtime_leg_id);
            if (existing) Object.assign(existing, structuredClone(row));
            else legs.push(Object.assign({ id: `leg-db-${legs.length + 1}` }, structuredClone(row)));
          }
          return Promise.resolve({ data: structuredClone(rows), error: null });
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
  }

  return { groups, legs, calls, from: tableApi };
}

function groupSnapshot(overrides = {}) {
  return {
    id: 'db-event-1:acc-demo',
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tradeAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sourceEventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sourceInstanceId: 'telegram-primary',
    sourceEventIds: ['telegram:-1001:10'],
    threadId: 'thread-1',
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entry: { kind: 'MARKET' },
    entryPrice: 2500,
    stopLoss: 2490,
    status: 'OPEN',
    incomplete: false,
    positionMode: 'HEDGED',
    riskPlan: { totalLots: 0.02 },
    policySnapshot: { allowed: true },
    createdAt: Date.parse('2026-09-14T10:00:00Z'),
    updatedAt: Date.parse('2026-09-14T10:00:05Z'),
    legs: [{
      legId: 'leg-1', targetIndex: 1, lots: 0.02, stopLoss: 2490, takeProfit: 2520,
      status: 'OPEN', brokerPositionId: '136177927', brokerOrderId: '43933042', brokerDealId: '40532264',
      fillPrice: 4315.13, executedLots: 0.02, volumeStepLots: 0.01, minimumLots: 0.01,
    }],
    ...overrides,
  };
}

test('materializes runtime group and broker-bound legs idempotently without treating composite runtime ids as UUIDs', async () => {
  const supabase = fakeSupabase();
  const snapshot = groupSnapshot();

  const first = await materializeTradeStateGroup({ supabase, workspaceId: snapshot.workspaceId, group: snapshot });
  const second = await materializeTradeStateGroup({ supabase, workspaceId: snapshot.workspaceId, group: snapshot });

  assert.equal(first.groupId, '11111111-1111-4111-8111-111111111111');
  assert.equal(second.groupId, first.groupId);
  assert.equal(supabase.groups.length, 1);
  assert.equal(supabase.legs.length, 1);
  assert.equal(supabase.groups[0].runtime_group_id, 'db-event-1:acc-demo');
  assert.equal(supabase.groups[0].id, '11111111-1111-4111-8111-111111111111');
  assert.equal(supabase.legs[0].position_group_id, supabase.groups[0].id);
  assert.equal(supabase.legs[0].runtime_leg_id, 'leg-1');
  assert.equal(supabase.legs[0].broker_position_id, '136177927');
  assert.equal(supabase.legs[0].broker_order_id, '43933042');
  assert.equal(supabase.legs[0].broker_deal_id, '40532264');
  assert.equal(supabase.legs[0].fill_price, 4315.13);
  assert.equal(supabase.legs[0].executed_lots, 0.02);
});

test('closed runtime legs persist terminal lifecycle without violating positive-lots relational constraint', async () => {
  const supabase = fakeSupabase();
  const initial = groupSnapshot();
  await materializeTradeStateGroup({ supabase, workspaceId: initial.workspaceId, group: initial });

  const closed = groupSnapshot({
    status: 'CLOSED',
    updatedAt: Date.parse('2026-09-14T10:01:00Z'),
    legs: [{
      ...initial.legs[0], status: 'CLOSED', lots: 0, executedLots: 0.02,
    }],
  });
  await materializeTradeStateGroup({ supabase, workspaceId: closed.workspaceId, group: closed });

  assert.equal(supabase.groups[0].status, 'CLOSED');
  assert.equal(supabase.legs[0].status, 'CLOSED');
  assert.equal(supabase.legs[0].lots, 0.02, 'terminal materialization retains the last positive lots value');
  assert.ok(supabase.legs[0].closed_at);
});

test('materialization rejects workspace mismatch before database writes', async () => {
  const supabase = fakeSupabase();
  await assert.rejects(
    () => materializeTradeStateGroup({ supabase, workspaceId: 'other-workspace', group: groupSnapshot() }),
    /workspace mismatch/i,
  );
  assert.equal(supabase.calls.length, 0);
});
