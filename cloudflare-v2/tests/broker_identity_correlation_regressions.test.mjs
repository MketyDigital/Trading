import test from 'node:test';
import assert from 'node:assert/strict';

import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';

const now = 1700000000000;

function group(overrides = {}) {
  return {
    id: 'g1',
    workspaceId: 'ws1',
    tradeAccountId: 'acct-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['telegram:-1001:100'],
    symbol: 'XAUUSD',
    side: 'BUY',
    status: 'OPEN',
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
    legs: [{ legId: 'leg-1', status: 'OPEN', brokerPositionId: 'position-1', brokerOrderId: 'order-1' }],
    ...overrides,
  };
}

function event() {
  return {
    workspace_hint: 'ws1',
    source: { instance_id: 'listener-1' },
    external_event_id: 'telegram:-1001:200',
    thread: {},
  };
}

test('management with explicit broker position id targets the matching active trade', () => {
  const result = correlateTradingEvent({
    event: event(),
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE', brokerPositionId: 'position-2' } },
    activeGroups: [
      group({ id: 'older', legs: [{ legId: 'a', status: 'OPEN', brokerPositionId: 'position-1' }] }),
      group({ id: 'target', sourceEventIds: ['telegram:-1001:150'], legs: [{ legId: 'b', status: 'OPEN', brokerPositionId: 'position-2' }] }),
    ],
    nowMs: now,
  });

  assert.deepEqual(result, { status: 'MATCHED', reason: 'BROKER_IDENTITY_TARGET', groupId: 'target' });
});

test('management with explicit broker order id targets the matching logical broker cohort', () => {
  const result = correlateTradingEvent({
    event: event(),
    interpretation: { status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING', broker_order_id: 'order-shared' } },
    activeGroups: [
      group({ id: 'ctrader', tradeAccountId: 'ctrader', sourceEventIds: ['telegram:-1001:100'], legs: [{ legId: 'c', status: 'PENDING', brokerOrderId: 'order-shared' }] }),
      group({ id: 'mt5', tradeAccountId: 'mt5', sourceEventIds: ['telegram:-1001:100'], legs: [{ legId: 'm', status: 'PENDING', brokerOrderId: 'order-shared' }] }),
    ],
    nowMs: now,
  });

  assert.deepEqual(result, { status: 'MATCHED', reason: 'BROKER_IDENTITY_TARGET', groupIds: ['ctrader', 'mt5'] });
});

test('unresolved explicit broker identity fails closed instead of falling through to recency', () => {
  const result = correlateTradingEvent({
    event: event(),
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE', position_id: 'missing-position' } },
    activeGroups: [group({ id: 'newest', updatedAt: now - 1000 })],
    nowMs: now,
  });

  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'NO_BROKER_IDENTITY_TARGET' });
});

test('ambiguous explicit broker identity fails closed', () => {
  const result = correlateTradingEvent({
    event: event(),
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE', brokerPositionId: 'duplicate-position' } },
    activeGroups: [
      group({ id: 'a', sourceEventIds: ['telegram:-1001:100'], legs: [{ legId: 'a1', status: 'OPEN', brokerPositionId: 'duplicate-position' }] }),
      group({ id: 'b', sourceEventIds: ['telegram:-1001:101'], legs: [{ legId: 'b1', status: 'OPEN', brokerPositionId: 'duplicate-position' }] }),
    ],
    nowMs: now,
  });

  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_BROKER_IDENTITY_TARGET' });
});
