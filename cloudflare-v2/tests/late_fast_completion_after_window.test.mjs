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
