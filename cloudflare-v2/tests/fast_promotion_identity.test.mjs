import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFastEntry } from '../src/execution/position_group.js';

const completed = {
  side: 'BUY',
  orderType: 'MARKET',
  symbol: { canonical: 'XAUUSD' },
  entry: { kind: 'RANGE', min: 4280.12, max: 4300.10 },
  stopLoss: 4180.6,
  takeProfits: [4300.5, 4360.9, 4450.3],
  fastEntry: false,
  incomplete: false,
};

test('one live fast leg becomes TP1 and only TP2/TP3 are newly opened', () => {
  const existing = {
    id: 'fast-group',
    symbol: 'XAUUSD',
    side: 'BUY',
    orderType: 'MARKET',
    entryPrice: 4297.05,
    entry: { kind: 'MARKET', executedPrice: 4297.05 },
    incomplete: true,
    legs: [{
      legId: 'leg-1',
      targetIndex: 1,
      lots: 0.01,
      status: 'OPEN',
      brokerPositionId: '5700468162',
      brokerOrderId: '5700468162',
      brokerDealId: '765124369',
      fillPrice: 4297.05,
      openedAt: '2026-09-14T22:56:30.000Z',
      stopLoss: null,
      takeProfit: null,
    }],
  };

  const result = reconcileFastEntry(existing, completed, { totalLots: 0.03, volumeStep: 0.01 });

  assert.deepEqual(result.actions.map((action) => [action.type, action.legId, action.targetIndex, action.stopLoss, action.takeProfit]), [
    ['MODIFY_POSITION', 'leg-1', 1, 4180.6, 4300.5],
    ['OPEN_POSITION', 'leg-2', 2, 4180.6, 4360.9],
    ['OPEN_POSITION', 'leg-3', 3, 4180.6, 4450.3],
  ]);
  assert.equal(result.actions[0].brokerPositionId, '5700468162');
  assert.equal(result.actions.filter((action) => action.type === 'OPEN_POSITION' && action.legId === 'leg-1').length, 0);
});
