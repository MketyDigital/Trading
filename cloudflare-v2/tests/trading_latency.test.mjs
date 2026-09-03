import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingLatencyTrace } from '../src/observability/trading_latency.js';

const ALLOWED = [
  'SOURCE_RECEIVED', 'EVENT_PERSISTED', 'INTERPRETATION_DONE', 'AI_START', 'AI_DONE',
  'PLAN_READY', 'IDEMPOTENCY_DONE', 'BROKER_SEND', 'BROKER_ACK',
  'DESTINATION_FORMAT_START', 'DESTINATION_FORMAT_DONE', 'DESTINATION_ACK',
];

test('records only the bounded launch latency marks and derives monotonic durations', () => {
  let now = 1000;
  const trace = createTradingLatencyTrace({
    eventId: 'evt-1', workspaceId: 'ws-1', clock: () => now,
  });

  for (const mark of ALLOWED) {
    trace.mark(mark);
    now += 5;
  }

  const summary = trace.summary();
  assert.equal(summary.eventId, 'evt-1');
  assert.equal(summary.workspaceId, 'ws-1');
  assert.deepEqual(Object.keys(summary.marks), ALLOWED);
  assert.equal(summary.durations.sourceToBrokerSendMs, 35);
  assert.equal(summary.durations.brokerRoundTripMs, 5);
  assert.equal(summary.durations.destinationFormatMs, 5);
  assert.equal(summary.durations.sourceToDestinationAckMs, 55);
});

test('rejects arbitrary marks and never accepts metadata or secret-bearing fields', () => {
  const trace = createTradingLatencyTrace({ eventId: 'evt-2', workspaceId: 'ws-1', clock: () => 1 });
  assert.throws(() => trace.mark('PASSWORD_LOOKUP'), /LATENCY_MARK_NOT_ALLOWED/);
  assert.throws(() => trace.mark('BROKER_SEND', { token: 'secret' }), /LATENCY_MARK_METADATA_NOT_ALLOWED/);
  const text = JSON.stringify(trace.summary());
  assert.doesNotMatch(text, /secret|token|password|api[_-]?key|credential/i);
});

test('clock failure or non-finite time cannot throw into the trading path', () => {
  const throwing = createTradingLatencyTrace({ eventId: 'evt-3', workspaceId: 'ws-1', clock: () => { throw new Error('clock failed'); } });
  assert.doesNotThrow(() => throwing.mark('BROKER_SEND'));
  assert.equal(throwing.summary().marks.BROKER_SEND, undefined);

  const invalid = createTradingLatencyTrace({ eventId: 'evt-4', workspaceId: 'ws-1', clock: () => Number.NaN });
  assert.doesNotThrow(() => invalid.mark('BROKER_ACK'));
  assert.equal(invalid.summary().marks.BROKER_ACK, undefined);
});

test('marking the same boundary twice keeps the first timestamp to prevent observer drift', () => {
  let now = 10;
  const trace = createTradingLatencyTrace({ eventId: 'evt-5', workspaceId: 'ws-1', clock: () => now });
  trace.mark('BROKER_SEND');
  now = 999;
  trace.mark('BROKER_SEND');
  assert.equal(trace.summary().marks.BROKER_SEND, 10);
});

test('trace identity is bounded to safe correlation IDs', () => {
  assert.throws(() => createTradingLatencyTrace({ eventId: '', workspaceId: 'ws-1' }), /eventId is required/);
  assert.throws(() => createTradingLatencyTrace({ eventId: 'evt', workspaceId: '' }), /workspaceId is required/);
  const trace = createTradingLatencyTrace({ eventId: 'evt', workspaceId: 'ws', clock: () => 10 });
  const summary = trace.summary();
  assert.deepEqual(Object.keys(summary).sort(), ['durations', 'eventId', 'marks', 'workspaceId']);
});
