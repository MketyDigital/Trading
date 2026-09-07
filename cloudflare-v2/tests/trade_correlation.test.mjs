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
    sourceEventIds: ['100'],
    threadId: null,
    symbol: 'XAUUSD',
    side: 'BUY',
    status: 'OPEN',
    incomplete: true,
    createdAt: now - 5000,
    updatedAt: now - 5000,
    ...overrides,
  };
}

test('matches a full signal to the recent incomplete fast-entry group and requests promotion', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '101', thread: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false } },
    activeGroups: [group()], nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g1' });
});

test('clusters per-account fast groups from the same source event as one completion target set', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '101', thread: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false } },
    activeGroups: [
      group({ id: 'g-account-a', tradeAccountId: 'acct-a', sourceEventIds: ['fast-source-1'] }),
      group({ id: 'g-account-b', tradeAccountId: 'acct-b', sourceEventIds: ['fast-source-1'] }),
    ],
    nowMs: now,
  });

  assert.deepEqual(result, {
    status: 'MATCHED',
    reason: 'FAST_ENTRY_COMPLETION',
    groupIds: ['g-account-a', 'g-account-b'],
  });
});

test('keeps genuinely distinct fast source events ambiguous even when symbol and side match', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '101', thread: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false } },
    activeGroups: [
      group({ id: 'g-fast-1', tradeAccountId: 'acct-a', sourceEventIds: ['fast-source-1'] }),
      group({ id: 'g-fast-2', tradeAccountId: 'acct-b', sourceEventIds: ['fast-source-2'] }),
    ],
    nowMs: now,
  });

  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_FAST_ENTRY_COMPLETION' });
});

test('reply metadata targets the exact originating position group for management', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '102', thread: { reply_to_event_id: '100' } },
    interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } },
    activeGroups: [group(), group({ id: 'g2', sourceEventIds: ['200'], symbol: 'EURUSD' })], nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'g1' });
});

test('thread id can target management when reply id is unavailable', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '103', thread: { thread_id: 'thread-a' } },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 } },
    activeGroups: [group({ threadId: 'thread-a' })], nowMs: now,
  });
  assert.equal(result.groupId, 'g1');
  assert.equal(result.reason, 'THREAD_TARGET');
});

test('does not correlate opposite-side or expired trades to a new full signal', () => {
  const opposite = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '104', thread: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'SELL', fastEntry: false, incomplete: false } },
    activeGroups: [group()], nowMs: now,
  });
  assert.equal(opposite.status, 'NEW_GROUP');

  const expired = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '105', thread: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false } },
    activeGroups: [group({ updatedAt: now - 15 * 60 * 1000 })], nowMs: now, correlationWindowMs: 120000,
  });
  assert.equal(expired.status, 'NEW_GROUP');
});

test('unthreaded management fails closed when multiple active groups could be targeted', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '106', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [group(), group({ id: 'g2', sourceEventIds: ['200'], symbol: 'EURUSD', incomplete: false })], nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' });
});

test('unthreaded management may target the only recent open group from the same source', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '107', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } },
    activeGroups: [group()], nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: 'g1' });
});
