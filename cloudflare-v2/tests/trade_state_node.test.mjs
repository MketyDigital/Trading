import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeStateNode } from '../src/state/trade_state_node.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.get(k); }
  async put(k,v) { this.map.set(k, structuredClone(v)); }
  async delete(k) { return this.map.delete(k); }
  async list({prefix=''}={}) { return new Map([...this.map].filter(([k]) => k.startsWith(prefix))); }
}

function node() {
  return new TradeStateNode({ storage: new MemoryStorage() }, { TRADE_STATE_INTERNAL_TOKEN: 'secret' });
}

function req(path, body, token='secret', method='POST', workspaceId) {
  const headers = { 'content-type':'application/json', 'x-mkety-internal-token':token };
  if (workspaceId) headers['x-mkety-workspace-id'] = workspaceId;
  return new Request(`https://state.internal${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('rejects state access without internal service credential', async () => {
  const res = await node().fetch(req('/groups/active', undefined, 'wrong', 'GET'));
  assert.equal(res.status, 401);
});

test('stores group and lists active durable state', async () => {
  const n = node();
  const group = { id:'g1',workspaceId:'ws1',sourceInstanceId:'listener-1',sourceEventIds:['100'],symbol:'XAUUSD',side:'BUY',status:'OPEN',incomplete:true,createdAt:100,updatedAt:100,legs:[] };
  assert.equal((await n.fetch(req('/groups', group))).status, 201);
  const res = await n.fetch(req('/groups/active', undefined, 'secret', 'GET'));
  const payload = await res.json();
  assert.deepEqual(payload.groups.map((g) => g.id), ['g1']);
});

test('correlates full signal against durable fast entry state', async () => {
  const n = node();
  await n.fetch(req('/groups', { id:'g1',workspaceId:'ws1',sourceInstanceId:'listener-1',sourceEventIds:['100'],symbol:'XAUUSD',side:'BUY',status:'OPEN',incomplete:true,createdAt:1000,updatedAt:1000,legs:[] }));
  const res = await n.fetch(req('/correlate', {
    nowMs: 1500,
    event:{source:{instance_id:'listener-1'},external_event_id:'101',thread:{}},
    interpretation:{status:'READY',intent:{symbol:{canonical:'XAUUSD'},side:'BUY',fastEntry:false,incomplete:false}},
  }));
  assert.deepEqual(await res.json(), { status:'MATCHED',reason:'FAST_ENTRY_COMPLETION',groupId:'g1' });
});

test('persists execution binding and source event update through internal api', async () => {
  const n = node();
  await n.fetch(req('/groups', { id:'g1',workspaceId:'ws1',sourceInstanceId:'listener-1',sourceEventIds:['100'],symbol:'XAUUSD',side:'BUY',status:'OPEN',incomplete:true,createdAt:100,updatedAt:100,legs:[{legId:'leg-1',status:'PLANNED',lots:0.03}] }));
  assert.equal((await n.fetch(req('/groups/g1/source-events', { externalEventId:'101', nowMs:200 }))).status, 200);
  assert.equal((await n.fetch(req('/groups/g1/legs/leg-1/execution', { brokerPositionId:'p1',status:'OPEN',nowMs:201 }))).status, 200);
  const res = await n.fetch(req('/groups/g1', undefined, 'secret', 'GET'));
  const group = await res.json();
  assert.deepEqual(group.sourceEventIds, ['100','101']);
  assert.equal(group.legs[0].brokerPositionId, 'p1');
});

test('binding a legacy pending order does not opt it into lifecycle tracking', async () => {
  const n = node();
  await n.fetch(req('/groups', { id:'g2',workspaceId:'ws1',tradeAccountId:'account-1',symbol:'EURUSD',side:'BUY',status:'PENDING',legs:[{legId:'leg-2',status:'PENDING',lots:0.1,brokerOrderId:'old-order'}] }));
  const response = await n.fetch(req('/groups/g2/legs/leg-2/execution', { brokerOrderId:'new-order',status:'PENDING' }));
  assert.equal(response.status, 200);
  const group = await (await n.fetch(req('/groups/g2', undefined, 'secret', 'GET'))).json();
  assert.equal(group.legs[0].lifecycleTrackingEnabled, undefined);
});

test('reconciles an exact-account pending order snapshot through its separate internal state route', async () => {
  const n = node();
  await n.fetch(req('/groups', {
    id: 'group-1', workspaceId: 'ws1', tradeAccountId: 'account-1', symbol: 'EURUSD', side: 'BUY', orderType: 'LIMIT', status: 'PENDING',
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.10, requestedLots: 0.10, status: 'PENDING', brokerOrderId: 'order-1', lifecycleTrackingEnabled: true }],
  }, 'secret', 'POST', 'ws1'));
  const response = await n.fetch(req('/groups/group-1/legs/leg-1/pending-order-snapshot', {
    tradeAccountId: 'account-1', brokerOrderId: 'order-1', nowMs: 200,
    snapshot: { status: 'PARTIALLY_FILLED', remainingLots: 0.06, fills: [{ dealId: 'deal-1', positionId: 'position-1', lots: 0.04, fillPrice: 1.08 }], observedAt: 190, sourceVersion: 'v1' },
  }, 'secret', 'POST', 'ws1'));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.outcome, 'APPLIED');
  assert.equal(payload.group.legs.find((leg) => leg.lifecycleRole === 'FILLED_POSITION').brokerPositionId, 'position-1');
});

test('pending order snapshot route rejects workspace mismatch without changing state', async () => {
  const n = node();
  await n.fetch(req('/groups', {
    id: 'group-1', workspaceId: 'ws1', tradeAccountId: 'account-1', symbol: 'EURUSD', side: 'BUY', orderType: 'LIMIT', status: 'PENDING',
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.10, status: 'PENDING', brokerOrderId: 'order-1' }],
  }, 'secret', 'POST', 'ws1'));
  const response = await n.fetch(req('/groups/group-1/legs/leg-1/pending-order-snapshot', {
    tradeAccountId: 'account-1', brokerOrderId: 'order-1',
    snapshot: { status: 'FILLED', remainingLots: 0, fills: [{ dealId: 'deal-1', positionId: 'position-1', lots: 0.10 }], observedAt: 190 },
  }, 'secret', 'POST', 'ws2'));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.outcome, 'MISMATCH');
  assert.equal((await n.fetch(req('/groups/group-1', undefined, 'secret', 'GET', 'ws1'))).status, 200);
  const saved = await (await n.fetch(req('/groups/group-1', undefined, 'secret', 'GET', 'ws1'))).json();
  assert.equal(saved.legs.length, 1);
  assert.equal(saved.legs[0].status, 'PENDING');
});
