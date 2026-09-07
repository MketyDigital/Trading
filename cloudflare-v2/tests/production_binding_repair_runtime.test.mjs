import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionBindingRepairRuntime } from '../src/execution/production_binding_repair.js';

function successfulDelivery() {
  return {
    id: 'delivery-1',
    workspace_id: 'ws-a',
    trading_event_id: 'event-1',
    destination_type: 'mt5',
    destination_ref: 'trade-account:acct-a',
    idempotency_key: 'event-1:acct-a:leg-1',
    status: 'SUCCEEDED',
    failure_class: 'STATE_BINDING_PENDING',
    request_payload: {
      destinationType: 'mt5',
      accountId: 'acct-a',
      groupId: 'group-a',
      action: {
        type: 'OPEN_POSITION',
        idempotencyKey: 'event-1:acct-a:leg-1',
        legId: 'leg-1',
      },
    },
    response_payload: {
      brokerPositionId: 'position-7',
      brokerOrderId: 'order-8',
      fillPrice: 2501.25,
    },
  };
}

function supabaseFor(row) {
  return {
    from(table) {
      assert.equal(table, 'destination_deliveries');
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return Promise.resolve({ data: [row], error: null }); },
        update(values) {
          assert.equal(values.failure_class, null);
          return {
            eq() { return this; },
            then(resolve) { return resolve({ data: null, error: null }); },
          };
        },
      };
      return query;
    },
  };
}

test('production binding repair composes Trade State binding from persisted successful delivery without broker execution', async () => {
  const row = successfulDelivery();
  const supabase = supabaseFor(row);
  const seen = { deps: [], bindings: [], brokerDispatches: 0 };

  const runtime = createProductionBindingRepairRuntime({
    supabaseFactory: async () => supabase,
    executionDepsFactory: async ({ workspaceId, tradingEventId }) => {
      seen.deps.push({ workspaceId, tradingEventId });
      return {
        stateBinder: async (binding) => { seen.bindings.push(binding); },
        dispatchAction: async () => { seen.brokerDispatches += 1; },
      };
    },
  });

  const result = await runtime({
    TRADING_ACCESS_ENABLED: 'false',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});

  assert.deepEqual(seen.deps, [{ workspaceId: 'ws-a', tradingEventId: 'event-1' }]);
  assert.equal(seen.bindings.length, 1);
  assert.equal(seen.brokerDispatches, 0);
  assert.deepEqual(result, { scanned: 1, repaired: 1, failed: 0 });
});
