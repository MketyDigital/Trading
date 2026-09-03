const SECRET_KEY = /(credential|token|secret|password|login|api[_-]?key|encrypted)/i;

function text(value) {
  return String(value ?? '').trim();
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function safeClone(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((item) => safeClone(item, seen));
    seen.delete(value);
    return output;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    output[key] = safeClone(item, seen);
  }
  seen.delete(value);
  return output;
}

function snapshotKey({ workspaceId, sourceId, accountId } = {}) {
  const workspace = text(workspaceId);
  const source = text(sourceId);
  const account = text(accountId);
  if (!workspace || !source || !account) return null;
  return `${workspace}\u001f${source}\u001f${account}`;
}

function safeNow(clock) {
  try {
    const value = Number(clock());
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

export function createRuntimeExecutionSnapshotCache({
  maxEntries = 256,
  ttlMs = 5000,
  clock = Date.now,
} = {}) {
  const limit = finitePositive(maxEntries, 256);
  const ttl = finitePositive(ttlMs, 5000);
  const now = typeof clock === 'function' ? clock : Date.now;
  const entries = new Map();

  function put(snapshot = {}) {
    const key = snapshotKey(snapshot);
    const version = text(snapshot.version);
    if (!key || !version) throw new TypeError('workspaceId, sourceId, accountId, and version are required');

    const storedAt = safeNow(now);
    const clean = safeClone(snapshot);
    entries.delete(key);
    entries.set(key, { version, storedAt, snapshot: clean });

    while (entries.size > limit) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }

    return safeClone(clean);
  }

  function get(identity = {}) {
    const key = snapshotKey(identity);
    const requestedVersion = text(identity.version);
    if (!key || !requestedVersion) return null;

    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.version !== requestedVersion) return null;

    if (safeNow(now) - entry.storedAt > ttl) {
      entries.delete(key);
      return null;
    }

    return safeClone(entry.snapshot);
  }

  function invalidate(identity = {}) {
    const key = snapshotKey(identity);
    if (!key) return false;
    return entries.delete(key);
  }

  function invalidateWorkspace(workspaceId) {
    const workspace = text(workspaceId);
    if (!workspace) return 0;
    let removed = 0;
    for (const [key, entry] of entries) {
      if (text(entry.snapshot?.workspaceId) !== workspace) continue;
      entries.delete(key);
      removed += 1;
    }
    return removed;
  }

  return {
    put,
    get,
    invalidate,
    invalidateWorkspace,
    size: () => entries.size,
  };
}
