const ALLOWED_MARKS = new Set([
  'SOURCE_RECEIVED',
  'EVENT_PERSISTED',
  'INTERPRETATION_DONE',
  'AI_START',
  'AI_DONE',
  'PLAN_READY',
  'IDEMPOTENCY_DONE',
  'BROKER_SEND',
  'BROKER_ACK',
  'DESTINATION_FORMAT_START',
  'DESTINATION_FORMAT_DONE',
  'DESTINATION_ACK',
]);

function text(value) {
  return String(value ?? '').trim();
}

function defaultClock() {
  if (typeof globalThis.performance?.now === 'function') return globalThis.performance.now();
  return Date.now();
}

function readClock(clock) {
  try {
    const value = Number(clock());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function duration(marks, start, end) {
  const a = marks[start];
  const b = marks[end];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

export function createTradingLatencyTrace({
  eventId,
  workspaceId,
  clock = defaultClock,
} = {}) {
  const safeEventId = text(eventId);
  const safeWorkspaceId = text(workspaceId);
  if (!safeEventId) throw new TypeError('eventId is required');
  if (!safeWorkspaceId) throw new TypeError('workspaceId is required');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  const marks = Object.create(null);

  return {
    mark(name, ...metadata) {
      const normalized = text(name).toUpperCase();
      if (!ALLOWED_MARKS.has(normalized)) throw new Error('LATENCY_MARK_NOT_ALLOWED');
      if (metadata.length > 0) throw new Error('LATENCY_MARK_METADATA_NOT_ALLOWED');
      if (Object.prototype.hasOwnProperty.call(marks, normalized)) return marks[normalized];

      const value = readClock(clock);
      if (value != null) marks[normalized] = value;
      return value;
    },

    summary() {
      const safeMarks = { ...marks };
      return {
        eventId: safeEventId,
        workspaceId: safeWorkspaceId,
        marks: safeMarks,
        durations: {
          sourceToBrokerSendMs: duration(safeMarks, 'SOURCE_RECEIVED', 'BROKER_SEND'),
          brokerRoundTripMs: duration(safeMarks, 'BROKER_SEND', 'BROKER_ACK'),
          destinationFormatMs: duration(safeMarks, 'DESTINATION_FORMAT_START', 'DESTINATION_FORMAT_DONE'),
          sourceToDestinationAckMs: duration(safeMarks, 'SOURCE_RECEIVED', 'DESTINATION_ACK'),
        },
      };
    },
  };
}
