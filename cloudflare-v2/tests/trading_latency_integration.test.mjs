import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';
import { dispatchDestinationFanout } from '../src/destinations/destination_fanout.js';

function account() {
  return {
    id: 'acct-1',
    workspace_id: 'ws-1',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
  };
}

function plan() {
  return {
    accountId: 'acct-1',
    groupId: 'grp-1',
    actions: [{
      type: 'OPEN_POSITION',
      legId: 'leg-1',
      idempotencyKey: 'idem-1',
      symbol: 'XAUUSD',
      lots: 0.01,
    }],
  };
}

test('broker timing marks observe dispatch without controlling it', async () => {
  const marks = [];
  let dispatches = 0;
  const result = await executeProductionPlan({
    workspaceId: 'ws-1', eventId: 'evt-1', accountPlans: [plan()], brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => {
      dispatches += 1;
      return { success: true, brokerPositionId: 'pos-1', fillPrice: 2526 };
    },
    stateBinder: async () => {},
    latencyTrace: { mark: (name) => marks.push(name) },
  });

  assert.equal(dispatches, 1);
  assert.equal(result.status, 'SUCCEEDED');
  assert.deepEqual(marks, ['BROKER_SEND', 'BROKER_ACK']);
});

test('latency observer failure cannot stop broker dispatch', async () => {
  let dispatches = 0;
  const result = await executeProductionPlan({
    workspaceId: 'ws-1', eventId: 'evt-2', accountPlans: [plan()], brokerExecutionEnabled: true,
  }, {
    accountLoader: async () => account(),
    dispatchAction: async () => {
      dispatches += 1;
      return { success: true, brokerPositionId: 'pos-2' };
    },
    latencyTrace: { mark: () => { throw new Error('telemetry failed'); } },
  });

  assert.equal(dispatches, 1);
  assert.equal(result.status, 'SUCCEEDED');
});

test('broker master fuse blocks before broker timing or expensive dependencies', async () => {
  let marks = 0;
  let accountLoads = 0;
  let dispatches = 0;
  const result = await executeProductionPlan({
    workspaceId: 'ws-1', eventId: 'evt-3', accountPlans: [plan()], brokerExecutionEnabled: false,
  }, {
    accountLoader: async () => { accountLoads += 1; return account(); },
    dispatchAction: async () => { dispatches += 1; return { success: true }; },
    latencyTrace: { mark: () => { marks += 1; } },
  });

  assert.equal(result.status, 'BROKER_EXECUTION_DISABLED');
  assert.equal(accountLoads, 0);
  assert.equal(dispatches, 0);
  assert.equal(marks, 0);
});

test('Telegram destination formatting and send expose optional timing marks', async () => {
  const marks = [];
  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-1',
    event: {
      id: 'evt-4', workspaceId: 'ws-1',
      intent: {
        side: 'BUY', symbol: { canonical: 'XAUUSD' }, entry: { value: 2526 },
        stopLoss: 2518, takeProfits: [2530],
      },
    },
    destinations: [{ id: 'tg-1', workspaceId: 'ws-1', type: 'telegram', presentation: {} }],
    dispatch: async () => ({ success: true, deliveryRef: 'msg-1' }),
    latencyTrace: { mark: (name) => marks.push(name) },
  });

  assert.equal(result.succeeded, 1);
  assert.deepEqual(marks, ['DESTINATION_FORMAT_START', 'DESTINATION_FORMAT_DONE', 'DESTINATION_ACK']);
});

test('Telegram latency observer failure cannot stop destination delivery', async () => {
  let sends = 0;
  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-1',
    event: {
      id: 'evt-5', workspaceId: 'ws-1',
      intent: {
        side: 'SELL', symbol: { canonical: 'XAUUSD' }, entry: { value: 2526 },
        stopLoss: 2532, takeProfits: [2520],
      },
    },
    destinations: [{ id: 'tg-1', workspaceId: 'ws-1', type: 'telegram', presentation: {} }],
    dispatch: async () => { sends += 1; return { success: true }; },
    latencyTrace: { mark: () => { throw new Error('metrics down'); } },
  });

  assert.equal(sends, 1);
  assert.equal(result.succeeded, 1);
});
