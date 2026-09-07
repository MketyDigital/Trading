const SECRET_KEY = /(credential|token|secret|password|login|api[_-]?key|encrypted)/i;
const ALLOWED_KEY_FIELDS = new Set(['purpose', 'provider', 'workspaceId']);

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function safeText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 256) return null;
  return text;
}

function normalizeKey(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  for (const key of Object.keys(input)) {
    if (SECRET_KEY.test(key)) return null;
    if (!ALLOWED_KEY_FIELDS.has(key)) return null;
  }

  const purpose = safeText(input.purpose);
  const provider = safeText(input.provider);
  const workspaceId = safeText(input.workspaceId);
  if (!purpose || !provider || !workspaceId) return null;

  return {
    id: `${purpose}\u001f${provider}\u001f${workspaceId}`,
    purpose,
    provider,
    workspaceId,
  };
}

function readClock(clock) {
  try {
    const value = Number(clock());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function closedResult() {
  return { allowed: true, state: 'CLOSED', retryAfterMs: 0 };
}

export function createProviderCircuitBreaker({
  failureThreshold = 3,
  resetAfterMs = 5000,
  maxCircuits = 256,
  clock = Date.now,
} = {}) {
  const threshold = boundedInteger(failureThreshold, 3, 1, 100);
  const resetMs = boundedInteger(resetAfterMs, 5000, 1, 3_600_000);
  const limit = boundedInteger(maxCircuits, 256, 1, 10_000);
  const now = typeof clock === 'function' ? clock : Date.now;
  const circuits = new Map();

  function touch(id, entry) {
    circuits.delete(id);
    circuits.set(id, entry);
    while (circuits.size > limit) {
      const oldest = circuits.keys().next().value;
      circuits.delete(oldest);
    }
  }

  function canAttempt(input) {
    const key = normalizeKey(input);
    const currentTime = readClock(now);
    if (!key || currentTime == null) return closedResult();

    const entry = circuits.get(key.id);
    if (!entry) return closedResult();

    if (entry.state === 'OPEN') {
      const retryAfterMs = Math.max(0, Math.ceil(entry.resetAt - currentTime));
      if (retryAfterMs > 0) {
        return { allowed: false, state: 'OPEN', retryAfterMs };
      }

      entry.state = 'HALF_OPEN';
      entry.probeInFlight = true;
      entry.touchedAt = currentTime;
      touch(key.id, entry);
      return { allowed: true, state: 'HALF_OPEN', retryAfterMs: 0 };
    }

    if (entry.state === 'HALF_OPEN') {
      if (entry.probeInFlight) {
        return { allowed: false, state: 'HALF_OPEN', retryAfterMs: 0 };
      }
      entry.probeInFlight = true;
      entry.touchedAt = currentTime;
      touch(key.id, entry);
      return { allowed: true, state: 'HALF_OPEN', retryAfterMs: 0 };
    }

    return closedResult();
  }

  function recordFailure(input) {
    const key = normalizeKey(input);
    const currentTime = readClock(now);
    if (!key || currentTime == null) return;

    const existing = circuits.get(key.id);
    if (existing?.state === 'HALF_OPEN') {
      touch(key.id, {
        state: 'OPEN',
        failures: threshold,
        resetAt: currentTime + resetMs,
        probeInFlight: false,
        touchedAt: currentTime,
      });
      return;
    }

    const failures = (existing?.failures ?? 0) + 1;
    const state = failures >= threshold ? 'OPEN' : 'CLOSED';
    touch(key.id, {
      state,
      failures,
      resetAt: state === 'OPEN' ? currentTime + resetMs : 0,
      probeInFlight: false,
      touchedAt: currentTime,
    });
  }

  function recordSuccess(input) {
    const key = normalizeKey(input);
    if (!key) return;
    circuits.delete(key.id);
  }

  return {
    canAttempt,
    recordFailure,
    recordSuccess,
    size: () => circuits.size,
  };
}
