import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';

const now = 1_700_000_000_000;

function fastGroup(overrides = {}) {
  return {
    id: 'g-fast',
    workspaceId: 'ws-1',
    tradeAccountId: 'acct-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['telegram:-1001:100'],
    threadId: null,
    symbol: 'XAUUSD',
    side: 'BUY',
    status: 'OPEN',
    incomplete: true,
    createdAt: now - 7 * 60 * 1000,
    updatedAt: now - 7 * 60 * 1000,
    ...overrides,
  };
}

function fullEvent(overrides = {}) {
  return {
    event: {
      workspace_hint: 'ws-1',
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:101',
      thread: {},
      ...overrides.event,
    },
    interpretation: {
      status: 'READY',
      intent: {
        symbol: { canonical: 'XAUUSD' },
        side: 'BUY',
        fastEntry: false,
        incomplete: false,
        ...overrides.intent,
      },
    },
  };
}

test('full signal still completes a unique fast trade after seven minutes', () => {
  const request = fullEvent();
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup()],
    nowMs: now,
    correlationWindowMs: 120_000,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g-fast' });
});

test('inference-only fast completion remains valid through 29 minutes 59 seconds', () => {
  const request = fullEvent();
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ createdAt: now - 1_799_000, updatedAt: now - 1_799_000 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g-fast' });
});

test('inference-only fast completion does not attach after the 30 minute window', () => {
  const request = fullEvent();
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ createdAt: now - 1_800_001, updatedAt: now - 1_800_001 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEW_GROUP' });
});

test('explicit reply completes the active fast trade even after 30 minutes', () => {
  const request = fullEvent({ event: { thread: { reply_to_event_id: 'telegram:-1001:100' } } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ createdAt: now - 3_600_000, updatedAt: now - 3_600_000 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g-fast' });
});

test('explicit thread completes the active fast trade even after 30 minutes', () => {
  const request = fullEvent({ event: { thread: { thread_id: 'thread-a' } } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ threadId: 'thread-a', createdAt: now - 3_600_000, updatedAt: now - 3_600_000 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g-fast' });
});

test('two distinct compatible incomplete trades inside 30 minutes fail closed', () => {
  const request = fullEvent();
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [
      fastGroup({ id: 'g-a', sourceEventIds: ['telegram:-1001:90'], updatedAt: now - 5 * 60 * 1000 }),
      fastGroup({ id: 'g-b', sourceEventIds: ['telegram:-1001:95'], updatedAt: now - 2 * 60 * 1000 }),
    ],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_FAST_ENTRY_COMPLETION' });
});

test('unresolved explicit reply can complete the unique compatible fast trade in its source context', () => {
  const request = fullEvent({ event: { thread: { reply_to_event_id: 'telegram:-1001:missing' } } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup()],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g-fast' });
});

test('EURJPY full follow-up with a missing middle reply updates the earlier fast source event', () => {
  const request = fullEvent({
    event: {
      workspace_hint: 'ws-1',
      source: { instance_id: 'main signal2' },
      external_event_id: 'telegram:-1001888176046:10208',
      thread: { reply_to_event_id: 'telegram:-1001888176046:10207' },
    },
    intent: { symbol: { canonical: 'EURJPY' }, side: 'BUY' },
  });
  const fast = fastGroup({
    sourceInstanceId: 'main signal2',
    sourceEventIds: ['telegram:-1001888176046:10206'],
    symbol: 'EURJPY',
    side: 'BUY',
    createdAt: now - 4 * 60 * 1000,
    updatedAt: now - 4 * 60 * 1000,
  });
  const result = correlateTradingEvent({ ...request, activeGroups: [fast], nowMs: now });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g-fast' });
});

test('source recovery replay uses original event time to preserve the fast-to-full interval', () => {
  const occurredAt = now - 60 * 60 * 1000;
  const request = fullEvent({
    event: {
      source: { instance_id: 'listener-1' },
      external_event_id: 'telegram:-1001:101',
      occurred_at: new Date(occurredAt).toISOString(),
      thread: { reply_to_event_id: 'telegram:-1001:missing' },
    },
  });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ createdAt: occurredAt - 4 * 60 * 1000, updatedAt: occurredAt - 4 * 60 * 1000 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: 'g-fast' });
});

test('opposite fast signal supersedes one recent incomplete group in the same source context', () => {
  const request = fullEvent({ intent: { side: 'BUY', incomplete: true, fastEntry: true } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ side: 'SELL', createdAt: now - 4 * 60 * 1000, updatedAt: now - 4 * 60 * 1000 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_SUPERSESSION', groupId: 'g-fast' });
});

test('opposite fast signal does not supersede a group outside the five minute window', () => {
  const request = fullEvent({ intent: { side: 'BUY', incomplete: true, fastEntry: true } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ side: 'SELL', createdAt: now - 5 * 60 * 1000 - 1, updatedAt: now - 5 * 60 * 1000 - 1 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEW_GROUP' });
});

test('opposite fast signal with an unresolved reply still supersedes its unique recent source-local group', () => {
  const request = fullEvent({
    event: { thread: { reply_to_event_id: 'telegram:-1001:101' } },
    intent: { side: 'BUY', incomplete: true, fastEntry: true },
  });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ side: 'SELL', createdAt: now - 60_000, updatedAt: now - 60_000 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'FAST_ENTRY_SUPERSESSION', groupId: 'g-fast' });
});

test('opposite fast signal from a different source instance does not supersede', () => {
  const request = fullEvent({ intent: { side: 'BUY', incomplete: true, fastEntry: true } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ side: 'SELL', sourceInstanceId: 'other-listener' })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEW_GROUP' });
});

test('explicit reply completion returns the whole logical multi-account fast cohort', () => {
  const request = fullEvent({ event: { thread: { reply_to_event_id: 'telegram:-1001:100' } } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [
      fastGroup({ id: 'g-ct', tradeAccountId: 'ct' }),
      fastGroup({ id: 'g-mt', tradeAccountId: 'mt' }),
    ],
    nowMs: now,
  });
  assert.deepEqual(result, {
    status: 'MATCHED',
    reason: 'FAST_ENTRY_COMPLETION',
    groupIds: ['g-ct', 'g-mt'],
  });
});
