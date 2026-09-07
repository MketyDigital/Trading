function requiredAccountId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error('CTRADER_SOURCE_ACCOUNT_REQUIRED');
  return normalized;
}

function clone(value) {
  return value == null ? null : structuredClone(value);
}

function extractSourceEvent(message, accountId) {
  if (Number(message?.payloadType) !== 2126) return null;
  const payload = message?.payload;
  if (!payload || String(payload.ctidTraderAccountId ?? '').trim() !== accountId) return null;

  const deal = payload.deal;
  const dealId = String(deal?.dealId ?? '').trim();
  const timestamp = Number(deal?.executionTimestamp);
  if (!dealId || !Number.isFinite(timestamp)) return null;

  const occurredAt = new Date(timestamp);
  if (Number.isNaN(occurredAt.getTime())) return null;

  return {
    providerType: 'ctrader_source',
    nativeEventId: dealId,
    occurredAt: occurredAt.toISOString(),
    structuredPayload: {
      execution_type: payload.executionType ?? null,
      deal: clone(deal),
      order: clone(payload.order),
      position: clone(payload.position),
    },
    metadata: {
      native_payload_type: 2126,
    },
  };
}

export function createCTraderSourceCapture({ session, runtime, accountId } = {}) {
  if (!session || typeof session.subscribeEvents !== 'function') {
    throw new Error('CTRADER_SOURCE_SESSION_REQUIRED');
  }
  if (!runtime || typeof runtime.deliver !== 'function') {
    throw new Error('CTRADER_SOURCE_RUNTIME_REQUIRED');
  }
  const scopedAccountId = requiredAccountId(accountId);

  const state = {
    status: 'idle',
    observedEvents: 0,
    ignoredEvents: 0,
    deliveredEvents: 0,
    failedEvents: 0,
    lastNativeEventId: null,
  };

  let unsubscribe = null;
  let running = false;
  let tail = Promise.resolve();

  function snapshot() {
    return { ...state };
  }

  function observe(message) {
    state.observedEvents += 1;
    const sourceEvent = extractSourceEvent(message, scopedAccountId);
    if (!sourceEvent) {
      state.ignoredEvents += 1;
      return;
    }

    tail = tail.then(async () => {
      state.lastNativeEventId = sourceEvent.nativeEventId;
      try {
        await runtime.deliver(sourceEvent);
        state.deliveredEvents += 1;
        state.status = 'healthy';
      } catch {
        state.failedEvents += 1;
        state.status = 'degraded';
      }
    });
  }

  function start() {
    if (running) return;
    running = true;
    state.status = 'listening';
    unsubscribe = session.subscribeEvents(observe);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    state.status = 'stopped';
  }

  function drain() {
    return tail;
  }

  return Object.freeze({
    start,
    stop,
    drain,
    status: snapshot,
  });
}
