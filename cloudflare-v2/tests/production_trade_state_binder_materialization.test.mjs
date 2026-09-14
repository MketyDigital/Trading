import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionTradeStateBinder } from '../src/state/production_trade_state_binder.js';

function supabaseRecorder() {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(payload, options = {}) {
          calls.push({ table, payload: structuredClone(payload), options: structuredClone(options) });
          if (table === 'position_groups') {
            return {
              select() { return this; },
              async maybeSingle() { return { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }; },
            };
          }
          return Promise.resolve({ data: payload, error: null });
        },
      };
    },
  };
}

function namespaceReturning(group, seen) {
  return {
    idFromName(name) { seen.workspace = name; return `do:${name}`; },
    get() {
      return {
        async fetch(_url, options) {
          seen.doPayload = JSON.parse(options.body);
          return new Response(JSON.stringify(group), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      };
    },
  };
}

test('production binding updates DO first then materializes the returned authoritative group snapshot', async () => {
  const seen = {};
  const supabase = supabaseRecorder();
  const group = {
    id: 'event-db-1:account-db-1',
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tradeAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    sourceEventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    sourceInstanceId: 'telegram-primary',
    sourceEventIds: ['telegram:-1001:10'],
    symbol: 'XAUUSD', side: 'BUY', orderType: 'MARKET', entry: { kind: 'MARKET' },
    status: 'OPEN', positionMode: 'HEDGED', policySnapshot: {}, createdAt: 1000, updatedAt: 2000,
    legs: [{
      legId: 'leg-1', targetIndex: 1, lots: 0.01, status: 'OPEN',
      brokerPositionId: 'p-1', brokerOrderId: 'o-1', brokerDealId: 'd-1', fillPrice: 2500,
      executedLots: 0.01, volumeStepLots: 0.01, minimumLots: 0.01,
    }],
  };
  const env = {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
    TRADE_STATE_NAMESPACE: namespaceReturning(group, seen),
  };

  const binder = createProductionTradeStateBinder({ env, workspaceId: group.workspaceId, supabase });
  const result = await binder({
    workspaceId: group.workspaceId,
    groupId: group.id,
    legId: 'leg-1',
    actionType: 'OPEN_POSITION',
    brokerPositionId: 'p-1', brokerOrderId: 'o-1', brokerDealId: 'd-1', fillPrice: 2500,
    executedLots: 0.01, volumeStepLots: 0.01, minimumLots: 0.01,
  });

  assert.equal(seen.workspace, group.workspaceId);
  assert.equal(seen.doPayload.brokerPositionId, 'p-1');
  assert.equal(result.id, group.id);
  assert.deepEqual(supabase.calls.map((call) => call.table), ['position_groups', 'position_legs']);
  assert.equal(supabase.calls[0].payload.runtime_group_id, group.id);
  assert.equal(supabase.calls[1].payload[0].runtime_leg_id, 'leg-1');
  assert.equal(supabase.calls[1].payload[0].broker_position_id, 'p-1');
});

test('production binding does not write relational state when authoritative DO mutation fails', async () => {
  const supabase = supabaseRecorder();
  const env = {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-token',
    TRADE_STATE_NAMESPACE: {
      idFromName() { return 'do'; },
      get() {
        return { async fetch() { return new Response(JSON.stringify({ error: 'missing' }), { status: 404 }); } };
      },
    },
  };
  const binder = createProductionTradeStateBinder({ env, workspaceId: 'ws-a', supabase });
  await assert.rejects(
    () => binder({ workspaceId: 'ws-a', groupId: 'g', legId: 'leg-1', brokerPositionId: 'p-1' }),
    /Trade State binding failed/i,
  );
  assert.equal(supabase.calls.length, 0);
});
