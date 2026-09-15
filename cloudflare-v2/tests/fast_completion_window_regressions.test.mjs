import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';

const now = 1700000000000;
const full = { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' }, side: 'BUY', fastEntry: false, incomplete: false } };

function group(overrides = {}) {
  return {
    id: 'g1', workspaceId: 'ws1', tradeAccountId: 'acct-1', sourceInstanceId: 'listener-1',
    sourceEventIds: ['telegram:-1001:297'], threadId: null, symbol: 'XAUUSD', side: 'BUY',
    status: 'OPEN', incomplete: true, createdAt: now - 60_000, updatedAt: now - 60_000,
    ...overrides,
  };
}

function event(thread = {}) {
  return { workspace_hint: 'ws1', source: { instance_id: 'listener-1' }, external_event_id: 'telegram:-1001:298', thread };
}

test('fast completion inference remains valid after seven minutes', () => {
  assert.deepEqual(correlateTradingEvent({
    event: event(), interpretation: full,
    activeGroups: [group({ updatedAt: now - 7 * 60_000 })], nowMs: now,
    correlationWindowMs: 120_000, fastCompletionWindowMs: 30 * 60_000,
  }), { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g1' });
});

test('fast completion inference remains valid at twenty-nine minutes', () => {
  assert.deepEqual(correlateTradingEvent({
    event: event(), interpretation: full,
    activeGroups: [group({ updatedAt: now - 29 * 60_000 })], nowMs: now,
    correlationWindowMs: 120_000, fastCompletionWindowMs: 30 * 60_000,
  }), { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g1' });
});

test('unreplied completion does not infer an incomplete group after thirty minutes', () => {
  assert.deepEqual(correlateTradingEvent({
    event: event(), interpretation: full,
    activeGroups: [group({ updatedAt: now - 31 * 60_000 })], nowMs: now,
    correlationWindowMs: 120_000, fastCompletionWindowMs: 30 * 60_000,
  }), { status: 'NEW_GROUP' });
});

test('explicit reply can complete the active fast trade after thirty minutes', () => {
  assert.deepEqual(correlateTradingEvent({
    event: event({ reply_to_event_id: 'telegram:-1001:297' }), interpretation: full,
    activeGroups: [group({ updatedAt: now - 90 * 60_000 })], nowMs: now,
    correlationWindowMs: 120_000, fastCompletionWindowMs: 30 * 60_000,
  }), { status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'g1' });
});

test('unresolved explicit reply fails closed instead of falling through to another trade', () => {
  const result = correlateTradingEvent({
    event: event({ reply_to_event_id: 'telegram:-1001:missing' }),
    interpretation: { status: 'MANAGEMENT', management: { type: 'CLOSE' } },
    activeGroups: [group()], nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'NO_REPLY_TARGET' });
});

test('two distinct compatible incomplete trades remain ambiguous within the completion window', () => {
  const result = correlateTradingEvent({
    event: event(), interpretation: full,
    activeGroups: [
      group({ id: 'a', sourceEventIds: ['telegram:-1001:290'], updatedAt: now - 5 * 60_000 }),
      group({ id: 'b', sourceEventIds: ['telegram:-1001:297'], updatedAt: now - 7 * 60_000 }),
    ], nowMs: now, fastCompletionWindowMs: 30 * 60_000,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_FAST_ENTRY_COMPLETION' });
});
