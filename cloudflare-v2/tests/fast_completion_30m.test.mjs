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
  assert.deepEqual(result, { status: 'MATCHED', reason: 'REPLY_TARGET', groupId: 'g-fast' });
});

test('explicit thread completes the active fast trade even after 30 minutes', () => {
  const request = fullEvent({ event: { thread: { thread_id: 'thread-a' } } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup({ threadId: 'thread-a', createdAt: now - 3_600_000, updatedAt: now - 3_600_000 })],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'THREAD_TARGET', groupId: 'g-fast' });
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

test('unresolved explicit reply does not fall through to inference and attach another fast trade', () => {
  const request = fullEvent({ event: { thread: { reply_to_event_id: 'telegram:-1001:missing' } } });
  const result = correlateTradingEvent({
    ...request,
    activeGroups: [fastGroup()],
    nowMs: now,
  });
  assert.deepEqual(result, { status: 'NEEDS_REVIEW', reason: 'NO_REPLY_TARGET' });
});
