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

test('reply management fans out across per-account groups created by the same source trade', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '102a', thread: { reply_to_event_id: 'telegram:-1001:238' } },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [
      group({ id: 'g-ctrader', tradeAccountId: 'ctrader', sourceEventIds: ['telegram:-1001:238'], symbol: 'BTCUSD' }),
      group({ id: 'g-mt5', tradeAccountId: 'mt5', sourceEventIds: ['telegram:-1001:238'], symbol: 'BTCUSD' }),
    ], nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'REPLY_TARGET', groupIds: ['g-ctrader', 'g-mt5'] });
});

test('reply-target management remains valid for the full life of an open group', () => {
  const old = group({ updatedAt: now - 45 * 60 * 1000, sourceEventIds: ['telegram:-1001:238'] });
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:240',
      thread: { reply_to_event_id: 'telegram:-1001:238' },
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [old], nowMs: now, correlationWindowMs: 120000,
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

test('does not correlate opposite-side or fast trades older than 30 minutes to a new full signal', () => {
  const opposite = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '104', thread: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'SELL', fastEntry: false, incomplete: false } },
    activeGroups: [group()], nowMs: now,
  });
  assert.equal(opposite.status, 'NEW_GROUP');

  const expired = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '105', thread: {} },
    interpretation: { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false } },
    activeGroups: [group({ createdAt: now - 31 * 60 * 1000, updatedAt: now - 31 * 60 * 1000 })], nowMs: now, correlationWindowMs: 120000,
  });
  assert.equal(expired.status, 'NEW_GROUP');
});

test('symbol-targeted management selects the matching active group even outside the fast-entry window', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '106', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE', symbol: { canonical: 'BTCUSD' } } },
    activeGroups: [
      group({ id: 'gold', symbol: 'XAUUSD', updatedAt: now - 30 * 60 * 1000 }),
      group({ id: 'btc', sourceEventIds: ['200'], symbol: 'BTCUSD', incomplete: false, updatedAt: now - 30 * 60 * 1000 }),
    ], nowMs: now, correlationWindowMs: 120000,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'SYMBOL_TARGET', groupId: 'btc' });
});

test('symbol-targeted management fans out across same-trade account groups', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '106a', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE', symbol: { canonical: 'BTCUSD' } } },
    activeGroups: [
      group({ id: 'btc-a', tradeAccountId: 'acct-a', sourceEventIds: ['telegram:-1001:238'], symbol: 'BTCUSD' }),
      group({ id: 'btc-b', tradeAccountId: 'acct-b', sourceEventIds: ['telegram:-1001:238'], symbol: 'BTCUSD' }),
    ], nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'SYMBOL_TARGET', groupIds: ['btc-a', 'btc-b'] });
});

test('symbol-targeted management fails closed when same-symbol groups are ambiguous', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '106b', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE', symbol: { canonical: 'BTCUSD' } } },
    activeGroups: [
      group({ id: 'btc-buy', symbol: 'BTCUSD', side: 'BUY' }),
      group({ id: 'btc-sell', sourceEventIds: ['201'], symbol: 'BTCUSD', side: 'SELL', incomplete: false }),
    ], nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' });
});

test('symbol-targeted management never falls back to a different only-active symbol', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '106c', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE', symbol: { canonical: 'BTCUSD' } } },
    activeGroups: [group({ id: 'gold', symbol: 'XAUUSD' })], nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'NO_MANAGEMENT_TARGET' });
});

test('unthreaded bare management fails closed when multiple active groups could be targeted', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '107', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [group(), group({ id: 'g2', sourceEventIds: ['200'], symbol: 'EURUSD', incomplete: false })], nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' });
});

test('unthreaded bare management treats per-account copies of one source signal as one active trade', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '107a', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [
      group({ id: 'same-a', tradeAccountId: 'acct-a', sourceEventIds: ['telegram:-1001:238'], symbol: 'BTCUSD' }),
      group({ id: 'same-b', tradeAccountId: 'acct-b', sourceEventIds: ['telegram:-1001:238'], symbol: 'BTCUSD' }),
    ], nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'ONLY_ACTIVE_TRADE', groupIds: ['same-a', 'same-b'] });
});

test('unthreaded bare management targets the only active open group even outside the fast-entry window', () => {
  const result = correlateTradingEvent({
    event: { source: { instance_id: 'listener-1' }, external_event_id: '108', thread: {} },
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [group({ updatedAt: now - 45 * 60 * 1000 })], nowMs: now, correlationWindowMs: 120000,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: 'g1' });
});


test('fresh actionable self-edit with no active trade becomes a new group', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:500',
      occurred_at: new Date(now - 1000).toISOString(),
      thread: { edited_event_id: 'telegram:-1001:500' },
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'EURCAD' },
        side: 'SELL',
        orderType: 'MARKET',
        entry: { kind: 'PRICE', value: 1.60439 },
        fastEntry: false,
        incomplete: true,
      },
    },
    activeGroups: [],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEW_GROUP' });
});

test('stale unmatched actionable edit remains fail-closed', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:500',
      occurred_at: new Date(now - 10 * 60 * 1000).toISOString(),
      thread: { edited_event_id: 'telegram:-1001:500' },
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'EURCAD' },
        side: 'SELL',
        orderType: 'MARKET',
        entry: { kind: 'PRICE', value: 1.60439 },
        fastEntry: false,
        incomplete: true,
      },
    },
    activeGroups: [],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'NO_EDIT_TARGET' });
});

test('fresh unmatched management edit remains fail-closed', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:501',
      occurred_at: new Date(now - 1000).toISOString(),
      thread: { edited_event_id: 'telegram:-1001:501' },
    },
    interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } },
    activeGroups: [],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'NO_EDIT_TARGET' });
});

test('self-contained READY reply with no active broker trade starts a new group', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:502',
      thread: { reply_to_event_id: 'telegram:-1001:501' },
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'GBPAUD' },
        side: 'SELL',
        orderType: 'MARKET',
        entry: { kind: 'PRICE', value: 1.90235 },
        stopLoss: 1.90499,
        takeProfits: [1.89982, 1.89869],
        fastEntry: false,
        incomplete: false,
      },
    },
    activeGroups: [],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEW_GROUP' });
});

test('unmatched READY reply still fails closed when another active trade exists', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:503',
      thread: { reply_to_event_id: 'telegram:-1001:missing' },
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'GBPAUD' },
        side: 'SELL',
        orderType: 'MARKET',
        entry: { kind: 'PRICE', value: 1.90235 },
        stopLoss: 1.90499,
        takeProfits: [1.89982, 1.89869],
        fastEntry: false,
        incomplete: false,
      },
    },
    activeGroups: [group()],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'NO_REPLY_TARGET' });
});


test('SL-only READY reply enriches an existing incomplete fast trade', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:101',
      thread: { reply_to_event_id: 'telegram:-1001:100' },
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'XAUUSD' },
        side: 'BUY',
        orderType: 'MARKET',
        entry: { kind: 'MARKET' },
        stopLoss: 2490,
        takeProfits: [],
        fastEntry: false,
        incomplete: true,
      },
    },
    activeGroups: [group({
      sourceEventIds: ['telegram:-1001:100'],
      symbol: 'XAUUSD',
      side: 'BUY',
      incomplete: true,
    })],
    nowMs: now,
  });
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reason, 'FAST_ENTRY_COMPLETION');
});

test('TP-only READY reply enriches an existing incomplete fast trade', () => {
  const result = correlateTradingEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:102',
      thread: { reply_to_event_id: 'telegram:-1001:100' },
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'XAUUSD' },
        side: 'BUY',
        orderType: 'MARKET',
        entry: { kind: 'MARKET' },
        stopLoss: null,
        takeProfits: [2510, 2520],
        fastEntry: false,
        incomplete: true,
      },
    },
    activeGroups: [group({
      sourceEventIds: ['telegram:-1001:100'],
      symbol: 'XAUUSD',
      side: 'BUY',
      incomplete: true,
    })],
    nowMs: now,
  });
  assert.equal(result.status, 'MATCHED');
  assert.equal(result.reason, 'FAST_ENTRY_COMPLETION');
});
