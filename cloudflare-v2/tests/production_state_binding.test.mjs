import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps.js';

function supabase() {
  return { from() { throw new Error('database should not be touched by state binding'); } };
}

function stateNamespace(seen, response = new Response(JSON.stringify({ id: 'group-1' }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
})) {
  return {
    idFromName(name) {
      seen.shard = name;
      return `do:${name}`;
    },
    get(id) {
      seen.doId = id;
      return {
        async fetch(url, options) {
          seen.url = String(url);
          seen.options = options;
          return response;
        },
      };
    },
  };
}

test('production state binder targets exact workspace shard and exact group leg with normalized broker identifiers only', async () => {
  const seen = {};
  const deps = createProductionExecutionDependencies({
    env: {
      TRADE_STATE_INTERNAL_TOKEN: 'internal-state-token',
      TRADE_STATE_NAMESPACE: stateNamespace(seen),
    },
    supabase: supabase(),
    workspaceId: 'ws-a',
  });

  await deps.stateBinder({
    workspaceId: 'ws-a',
    eventId: 'event-db-1',
    accountId: 'acct-a',
    groupId: 'group-1',
    legId: 'leg-2',
    brokerPositionId: 12345,
    brokerOrderId: 'order-9',
    brokerDealId: 'deal-3',
    fillPrice: '2501.75',
    bridgeSecret: 'must-not-persist',
    accessToken: 'must-not-persist',
    rawBrokerResponse: { secret: 'must-not-persist' },
  });

  assert.equal(seen.shard, 'ws-a');
  assert.equal(seen.doId, 'do:ws-a');
  assert.match(seen.url, /\/groups\/group-1\/legs\/leg-2\/execution$/);
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers['x-mkety-internal-token'], 'internal-state-token');

  const persisted = JSON.parse(seen.options.body);
  assert.deepEqual(persisted, {
    brokerPositionId: '12345',
    brokerOrderId: 'order-9',
    brokerDealId: 'deal-3',
    fillPrice: 2501.75,
  });
  assert.equal(JSON.stringify(persisted).includes('must-not-persist'), false);
  assert.equal(Object.hasOwn(persisted, 'eventId'), false);
  assert.equal(Object.hasOwn(persisted, 'accountId'), false);
});

test('production state binder rejects workspace mismatch or missing exact group leg before touching Durable Object namespace', async () => {
  const seen = { namespaceCalls: 0 };
  const namespace = {
    idFromName() { seen.namespaceCalls += 1; return 'do'; },
    get() { seen.namespaceCalls += 1; return { fetch() { throw new Error('must not fetch'); } }; },
  };
  const deps = createProductionExecutionDependencies({
    env: { TRADE_STATE_INTERNAL_TOKEN: 'token', TRADE_STATE_NAMESPACE: namespace },
    supabase: supabase(),
    workspaceId: 'ws-a',
  });

  await assert.rejects(() => deps.stateBinder({ workspaceId: 'ws-b', groupId: 'group-1', legId: 'leg-1' }), /workspace mismatch/i);
  await assert.rejects(() => deps.stateBinder({ workspaceId: 'ws-a', groupId: '', legId: 'leg-1' }), /groupId/i);
  await assert.rejects(() => deps.stateBinder({ workspaceId: 'ws-a', groupId: 'group-1', legId: '' }), /legId/i);
  assert.equal(seen.namespaceCalls, 0);
});

test('production state binder fails closed on missing internal Trade State authority or failed state response', async () => {
  const missing = createProductionExecutionDependencies({
    env: {},
    supabase: supabase(),
    workspaceId: 'ws-a',
  });
  await assert.rejects(
    () => missing.stateBinder({ workspaceId: 'ws-a', groupId: 'group-1', legId: 'leg-1', brokerPositionId: 'p1' }),
    /TRADE_STATE_(INTERNAL_TOKEN|NAMESPACE)/,
  );

  const failed = createProductionExecutionDependencies({
    env: {
      TRADE_STATE_INTERNAL_TOKEN: 'token',
      TRADE_STATE_NAMESPACE: stateNamespace({}, new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
    },
    supabase: supabase(),
    workspaceId: 'ws-a',
  });
  await assert.rejects(
    () => failed.stateBinder({ workspaceId: 'ws-a', groupId: 'group-1', legId: 'leg-1', brokerPositionId: 'p1' }),
    /Trade State binding failed/i,
  );
});
