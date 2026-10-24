import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';

const intent = {
  symbol: { canonical: 'XAUUSD' }, side: 'BUY', orderType: 'MARKET',
  entry: { kind: 'MARKET' }, stopLoss: 2300,
  takeProfits: [2350, 2400, 2450], incomplete: false,
};
const group = (overrides = {}) => ({
  id: 'fast-group-old', workspaceId: 'ws', tradeAccountId: 'acct',
  sourceInstanceId: 'source', sourceEventIds: ['telegram:-1001:10'],
  symbol: 'XAUUSD', side: 'BUY', incomplete: false, status: 'OPEN',
  createdAt: 1_000_000, updatedAt: 1_000_000,
  legs: [{legId:'leg-1',targetIndex:1,status:'OPEN',brokerPositionId:'position-1',
    stopLoss:null,takeProfit:null}],
  ...overrides,
});

for (const relation of [
  { name: 'explicit reply', thread: { reply_to_event_id: 'telegram:-1001:10' } },
  { name: 'explicit edit', external_event_id: 'telegram:-1001:10:revision-2',
    thread: { edited_event_id: 'telegram:-1001:10' } },
]) {
  test(`${relation.name} promotes an old unprotected fast trade`, () => {
    const nowMs = 4_000_000;
    const result = correlateTradingEvent({
      event: {
        workspace_hint:'ws', source:{instance_id:'source'},
        external_event_id: relation.external_event_id ?? 'telegram:-1001:11',
        occurred_at: nowMs, thread: relation.thread,
      },
      interpretation:{status:'READY',intent},
      activeGroups:[group()], nowMs, fastCompletionWindowMs:30*60*1000,
    });
    assert.deepEqual(result,{status:'MATCHED',reason:'FAST_ENTRY_COMPLETION',groupId:'fast-group-old'});
  });
}

test('protected complete group is not reclassified as an unprotected fast recovery', () => {
  const nowMs = 4_000_000;
  const result = correlateTradingEvent({
    event:{workspace_hint:'ws',source:{instance_id:'source'},external_event_id:'telegram:-1001:11',
      occurred_at:nowMs,thread:{reply_to_event_id:'telegram:-1001:10'}},
    interpretation:{status:'READY',intent},
    activeGroups:[group({legs:[{legId:'leg-1',targetIndex:1,status:'OPEN',
      brokerPositionId:'position-1',stopLoss:2290,takeProfit:2350}]})],
    nowMs,
  });
  assert.deepEqual(result,{status:'NEW_GROUP'});
});

test('a full signal replied to a missed fast entry opens every TP as a fresh position', async () => {
  const { orchestrateTradingEventSimulation } = await import('../src/pipeline/v1_orchestrator.js');
  const saved = [];
  const event = {
    workspace_hint: 'ws',
    source: { instance_id: 'source' },
    external_event_id: 'telegram:-1001:12',
    occurred_at: 4_000_000,
    thread: { reply_to_event_id: 'telegram:-1001:11' },
    text: 'XAUUSD BUY full signal',
  };
  const interpretation = {
    status: 'READY',
    intent: {
      symbol: { canonical: 'XAUUSD' },
      side: 'BUY',
      orderType: 'MARKET',
      entry: { kind: 'RANGE', min: 100, max: 101 },
      stopLoss: 95,
      takeProfits: [105, 110, 115],
      incomplete: false,
    },
  };
  const result = await orchestrateTradingEventSimulation({
    event,
    eventId: 'missed-fast-full-event',
    nowMs: 4_000_000,
    interpretation,
  }, {
    stateCoordinator: {
      correlate: async (incomingEvent, incomingInterpretation, nowMs) =>
        correlateTradingEvent({event:incomingEvent,interpretation:incomingInterpretation,activeGroups:[],nowMs}),
    },
    stateStore: {
      putGroup: async (savedGroup) => saved.push(structuredClone(savedGroup)),
    },
    accountProvider: async () => [{
      id: 'acct',
      workspace_id: 'ws',
      execution_enabled: true,
      lot_sizing_type: 'fixed',
      lot_value: 0.03,
      safety_policy: { enabled: true, killSwitch: false },
      entry_zone_policy: { mode: 'market_only' },
    }],
    instrumentProvider: async () => ({minLots:0.01,maxLots:10,stepLots:0.01}),
    marketPriceProvider: async () => 101,
  });

  assert.equal(result.correlation.status, 'NEW_GROUP');
  assert.equal(result.accounts[0].status, 'READY');
  assert.equal(result.accounts[0].groupId, 'missed-fast-full-event:acct');
  assert.deepEqual(result.accounts[0].actions.map((action) => action.type),
    ['OPEN_POSITION','OPEN_POSITION','OPEN_POSITION']);
  assert.deepEqual(result.accounts[0].actions.map((action) => action.targetIndex), [1,2,3]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].legs.length, 3);
});
