import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchDestinationFanout } from '../src/destinations/destination_fanout.js';

function destination(id, workspaceId = 'ws-a') {
  return { id, workspaceId, type: 'simulation', accountRef: `acct-${id}` };
}

test('one destination failure never blocks or rolls back successful siblings', async () => {
  const calls = [];
  const destinations = [destination('a'), destination('b'), destination('c')];

  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations,
    event: { id: 'event-1' },
    dispatch: async ({ destination: target }) => {
      calls.push(target.id);
      if (target.id === 'b') throw new Error('destination-b-secret-error');
      return { success: true, deliveryRef: `delivery-${target.id}` };
    },
  });

  assert.deepEqual(calls.sort(), ['a', 'b', 'c']);
  assert.equal(result.ok, false);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.outcomes.map((item) => [item.destinationId, item.status]), [
    ['a', 'SUCCEEDED'],
    ['b', 'FAILED'],
    ['c', 'SUCCEEDED'],
  ]);
  assert.equal(JSON.stringify(result).includes('destination-b-secret-error'), false);
});

test('retrying one failed destination does not redispatch successful siblings', async () => {
  const counts = new Map();
  const destinations = [destination('a'), destination('b')];

  const first = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations,
    event: { id: 'event-2' },
    dispatch: async ({ destination: target }) => {
      counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
      if (target.id === 'b') throw new Error('temporary');
      return { success: true };
    },
  });

  const failedOnly = destinations.filter((target) => first.outcomes.find((item) => item.destinationId === target.id)?.status === 'FAILED');
  await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: failedOnly,
    event: { id: 'event-2' },
    dispatch: async ({ destination: target }) => {
      counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
      return { success: true };
    },
  });

  assert.equal(counts.get('a'), 1);
  assert.equal(counts.get('b'), 2);
});

test('workspace mismatch fails locally without dispatching any destination', async () => {
  let dispatches = 0;
  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: [destination('a'), destination('foreign', 'ws-b'), destination('c')],
    event: { id: 'event-3' },
    dispatch: async () => { dispatches += 1; return { success: true }; },
  });

  assert.equal(dispatches, 2);
  assert.deepEqual(result.outcomes.map((item) => [item.destinationId, item.status]), [
    ['a', 'SUCCEEDED'],
    ['foreign', 'REJECTED'],
    ['c', 'SUCCEEDED'],
  ]);
});

test('duplicate destination ids are rejected independently instead of double-dispatched', async () => {
  const calls = [];
  const result = await dispatchDestinationFanout({
    workspaceId: 'ws-a',
    destinations: [destination('a'), destination('a'), destination('b')],
    event: { id: 'event-4' },
    dispatch: async ({ destination: target }) => { calls.push(target.id); return { success: true }; },
  });

  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(result.outcomes.map((item) => item.status), ['SUCCEEDED', 'REJECTED', 'SUCCEEDED']);
});
