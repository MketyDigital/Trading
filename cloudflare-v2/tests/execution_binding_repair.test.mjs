import test from 'node:test';
import assert from 'node:assert/strict';

import { repairExecutionBindings } from '../src/execution/execution_binding_repair.js';

function successfulDelivery(overrides = {}) {
  return {
    id: 'delivery-1',
    workspace_id: 'ws-a',
    trading_event_id: 'event-1',
    destination_type: 'mt5',
    destination_ref: 'trade-account:acct-a',
    idempotency_key: 'event-1:acct-a:leg-1',
    status: 'SUCCEEDED',
    failure_class: 'STATE_BINDING_PENDING',
    error_code: 'STATE_BIND_FAILED',
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
      duplicate: false,
      brokerPositionId: 'position-7',
      brokerOrderId: 'order-8',
      brokerDealId: 'deal-9',
      fillPrice: 2501.25,
    },
    ...overrides,
  };
}

function supabaseFor(rows, seen) {
  return {
    from(table) {
      assert.equal(table, 'destination_deliveries');
      const query = {
        select() { return query; },
        eq(field, value) {
          seen.filters.push([field, value]);
          return query;
        },
        order() { return query; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
        update(values) {
          seen.updates.push(values);
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

test('repair binds persisted successful broker truth and never dispatches broker work', async () => {
  const seen = { filters: [], updates: [], bindings: [], brokerDispatches: 0 };
  const row = successfulDelivery();
  const result = await repairExecutionBindings({
    supabase: supabaseFor([row], seen),
    stateBinder: async (binding) => { seen.bindings.push(binding); },
    brokerExecutor: async () => { seen.brokerDispatches += 1; },
    limit: 10,
    now: '2026-09-04T08:00:00.000Z',
  });

  assert.equal(seen.brokerDispatches, 0);
  assert.equal(seen.bindings.length, 1);
  assert.deepEqual(seen.bindings[0], {
    workspaceId: 'ws-a',
    eventId: 'event-1',
    accountId: 'acct-a',
    groupId: 'group-a',
    legId: 'leg-1',
    brokerPositionId: 'position-7',
    brokerOrderId: 'order-8',
    brokerDealId: 'deal-9',
    fillPrice: 2501.25,
  });
  assert.deepEqual(result, { scanned: 1, repaired: 1, failed: 0 });
  assert.equal(seen.updates.some((item) => item.status && item.status !== 'SUCCEEDED'), false);
});

test('repair scans only successful binding-pending deliveries and marks a completed repair non-resendable', async () => {
  const seen = { filters: [], updates: [], bindings: [] };
  const result = await repairExecutionBindings({
    supabase: supabaseFor([successfulDelivery()], seen),
    stateBinder: async (binding) => { seen.bindings.push(binding); },
    limit: 5,
    now: '2026-09-04T08:00:00.000Z',
  });

  assert.equal(result.repaired, 1);
  assert.ok(seen.filters.some(([field, value]) => field === 'status' && value === 'SUCCEEDED'));
  assert.ok(seen.filters.some(([field, value]) => field === 'failure_class' && value === 'STATE_BINDING_PENDING'));
  assert.ok(seen.updates.some((item) => item.failure_class === null && item.error_code === null));
  assert.equal(seen.updates.some((item) => item.status === 'RETRYABLE'), false);
});

test('repair is fail-closed on mismatched durable identity and never binds caller-shaped broker truth', async () => {
  const bad = successfulDelivery({
    destination_ref: 'trade-account:acct-other',
  });
  const seen = { filters: [], updates: [], bindings: [] };
  const result = await repairExecutionBindings({
    supabase: supabaseFor([bad], seen),
    stateBinder: async (binding) => { seen.bindings.push(binding); },
    limit: 5,
    now: '2026-09-04T08:00:00.000Z',
  });

  assert.equal(seen.bindings.length, 0);
  assert.deepEqual(result, { scanned: 1, repaired: 0, failed: 1 });
});
