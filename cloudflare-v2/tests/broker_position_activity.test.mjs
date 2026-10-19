import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBrokerPositionActivity } from '../src/execution/broker_tp_fill_detection.js';

test('broker activity classifies confirmed manual full and partial closes without mislabeling them as TP', () => {
  const full = classifyBrokerPositionActivity({ platform: 'mt5', leg: { brokerPositionId: 'p1' }, snapshot: {
    positionId: 'p1', isOpen: false, initialLots: 0.2, closedLots: 0.2,
    deals: [{ dealId: 'd1', positionId: 'p1', lots: 0.2, entry: 'OUT', reason: 'CLIENT' }],
  } });
  assert.equal(full.status, 'ACTIVITY_CONFIRMED');
  assert.equal(full.kind, 'MANUAL');
  const partial = classifyBrokerPositionActivity({ platform: 'mt5', leg: { brokerPositionId: 'p1' }, snapshot: {
    positionId: 'p1', isOpen: true, initialLots: 0.2, closedLots: 0.1,
    deals: [{ dealId: 'd2', positionId: 'p1', lots: 0.1, entry: 'OUT', reason: 'SL' }],
  } });
  assert.equal(partial.kind, 'PARTIAL_STOP_LOSS');
});

test('uncertain or unrelated broker history never becomes a lifecycle event', () => {
  const result = classifyBrokerPositionActivity({ platform: 'mt5', leg: { brokerPositionId: 'p1' }, snapshot: {
    positionId: 'p1', isOpen: true, initialLots: 0.2, closedLots: 0,
    deals: [{ dealId: 'd1', positionId: 'other', lots: 0.2, entry: 'OUT', reason: 'CLIENT' }],
  } });
  assert.equal(result.status, 'UNRESOLVED');
});
