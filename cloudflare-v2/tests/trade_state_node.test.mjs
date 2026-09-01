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

function req(path, body, token='secret', method='POST') {
  return new Request(`https://state.internal${path}`, {
    method,
    headers: { 'content-type':'application/json', 'x-mkety-internal-token':token },
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
