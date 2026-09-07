import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REQUIRED_NAMES = [
  'MTPROTO_SOAK_HEALTH_URL',
  'MTPROTO_SOAK_EVENTS_URL',
  'MTPROTO_SOAK_WORKSPACE_ID',
  'MTPROTO_SOAK_SOURCE_ID',
];

function present(value) {
  return String(value ?? '').trim().length > 0;
}

function finiteMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function digestCanonicalEventId(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

export function validateSoakEnvironment(env = {}) {
  if (String(env.MTPROTO_SOAK_ENABLED ?? '').toLowerCase() !== 'true') {
    return { ok: false, reason: 'SOAK_NOT_ENABLED', missing: ['MTPROTO_SOAK_ENABLED'] };
  }

  const missing = REQUIRED_NAMES.filter((name) => !present(env[name]));
  if (missing.length > 0) return { ok: false, reason: 'SOAK_CONFIG_MISSING', missing };
  return { ok: true, missing: [] };
}

export function createSoakMetrics({ workspaceId, sourceId, startedAtMs = Date.now() } = {}) {
  return {
    workspaceId: String(workspaceId ?? ''),
    sourceId: String(sourceId ?? ''),
    startedAtMs: Number(startedAtMs),
    eventCount: 0,
    uniqueEventCount: 0,
    duplicateCount: 0,
    catchUpCount: 0,
    editedCount: 0,
    disconnectCount: 0,
    reconnectCount: 0,
    downstreamIsolationObserved: false,
    containerTouched: false,
    latencyMs: [],
    healthTransitions: [],
    lastConnected: null,
    lastHealthStatus: null,
    _seenEventIds: new Set(),
    _canonicalEventDigests: new Set(),
  };
}

export function recordHealthSample(metrics, sample = {}, atMs = Date.now()) {
  const status = String(sample.status ?? 'UNKNOWN').toUpperCase();
  const connected = Boolean(sample.connected);
  const changed = metrics.lastHealthStatus !== status || metrics.lastConnected !== connected;

  if (metrics.lastConnected === true && connected === false) metrics.disconnectCount += 1;
  if (metrics.lastConnected === false && connected === true) metrics.reconnectCount += 1;

  if (changed) metrics.healthTransitions.push({ atMs: Number(atMs), status, connected });
  if (Boolean(sample.downstreamIsolationObserved ?? sample.downstream_isolation_observed)) metrics.downstreamIsolationObserved = true;
  if (Boolean(sample.containerTouched ?? sample.container_touched)) metrics.containerTouched = true;
  metrics.lastHealthStatus = status;
  metrics.lastConnected = connected;
  return metrics;
}

export function recordEventSample(metrics, sample = {}) {
  const canonicalEventId = String(sample.canonicalEventId ?? sample.canonical_event_id ?? '').trim();
  if (!canonicalEventId) return metrics;

  metrics.eventCount += 1;
  metrics._canonicalEventDigests.add(digestCanonicalEventId(canonicalEventId));
  if (metrics._seenEventIds.has(canonicalEventId)) metrics.duplicateCount += 1;
  else {
    metrics._seenEventIds.add(canonicalEventId);
    metrics.uniqueEventCount += 1;
  }

  if (Boolean(sample.catchUp ?? sample.catch_up)) metrics.catchUpCount += 1;
  if (Boolean(sample.edited ?? sample.is_edited)) metrics.editedCount += 1;
  if (Boolean(sample.downstreamIsolationObserved ?? sample.downstream_isolation_observed)) metrics.downstreamIsolationObserved = true;
  if (Boolean(sample.containerTouched ?? sample.container_touched)) metrics.containerTouched = true;

  const occurredAtMs = Date.parse(sample.occurredAt ?? sample.occurred_at ?? '');
  const receivedAtMs = Date.parse(sample.receivedAt ?? sample.received_at ?? '');
  if (Number.isFinite(occurredAtMs) && Number.isFinite(receivedAtMs)) {
    metrics.latencyMs.push(Math.max(0, receivedAtMs - occurredAtMs));
  }
  return metrics;
}

function latencySummary(values) {
  if (!Array.isArray(values) || values.length === 0) return { min: null, max: null, avg: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min, max, avg };
}

export function buildSoakSummary(metrics, { endedAtMs = Date.now() } = {}) {
  return {
    workspaceId: metrics.workspaceId,
    sourceId: metrics.sourceId,
    durationMs: Math.max(0, Number(endedAtMs) - Number(metrics.startedAtMs)),
    eventCount: metrics.eventCount,
    uniqueEventCount: metrics.uniqueEventCount,
    duplicateCount: metrics.duplicateCount,
    catchUpCount: metrics.catchUpCount,
    editedCount: metrics.editedCount,
    disconnectCount: metrics.disconnectCount,
    reconnectCount: metrics.reconnectCount,
    downstreamIsolationObserved: metrics.downstreamIsolationObserved,
    containerTouched: metrics.containerTouched,
    canonicalEventDigests: [...metrics._canonicalEventDigests],
    latencyMs: latencySummary(metrics.latencyMs),
    healthTransitions: metrics.healthTransitions.map((item) => ({ ...item })),
    finalHealthStatus: metrics.lastHealthStatus,
    finalConnected: metrics.lastConnected,
  };
}

async function readJson(url, bearerToken, fetchImpl) {
  const headers = { Accept: 'application/json' };
  if (present(bearerToken)) headers.Authorization = `Bearer ${bearerToken}`;
  const response = await fetchImpl(url, { method: 'GET', headers });
  if (!response.ok) throw new Error('SOAK_OBSERVATION_REQUEST_FAILED');
  return response.json();
}

export async function runSoak({ env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now } = {}) {
  const validation = validateSoakEnvironment(env);
  if (!validation.ok) return validation;

  const durationMs = finiteMs(env.MTPROTO_SOAK_DURATION_MS, 60_000);
  const pollMs = Math.min(finiteMs(env.MTPROTO_SOAK_POLL_MS, 5_000), durationMs);
  const startedAtMs = Number(now());
  const metrics = createSoakMetrics({
    workspaceId: env.MTPROTO_SOAK_WORKSPACE_ID,
    sourceId: env.MTPROTO_SOAK_SOURCE_ID,
    startedAtMs,
  });
  const seenObservationIds = new Set();

  while (Number(now()) - startedAtMs < durationMs) {
    const health = await readJson(env.MTPROTO_SOAK_HEALTH_URL, env.MTPROTO_SOAK_BEARER_TOKEN, fetchImpl);
    recordHealthSample(metrics, health, Number(now()));

    const eventPayload = await readJson(env.MTPROTO_SOAK_EVENTS_URL, env.MTPROTO_SOAK_BEARER_TOKEN, fetchImpl);
    const events = Array.isArray(eventPayload) ? eventPayload : Array.isArray(eventPayload?.events) ? eventPayload.events : [];
    for (const event of events) {
      const observationId = String(event.observationId ?? event.observation_id ?? `${event.canonicalEventId ?? event.canonical_event_id ?? ''}:${event.receivedAt ?? event.received_at ?? ''}`);
      if (seenObservationIds.has(observationId)) continue;
      seenObservationIds.add(observationId);
      recordEventSample(metrics, event);
    }

    if (Number(now()) - startedAtMs >= durationMs) break;
    await sleep(pollMs);
  }

  return { ok: true, summary: buildSoakSummary(metrics, { endedAtMs: Number(now()) }) };
}

async function main() {
  const result = await runSoak();
  if (!result.ok) {
    console.error(JSON.stringify(result));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(result.summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ ok: false, reason: 'SOAK_RUNTIME_FAILED' }));
    process.exitCode = 1;
  });
}
