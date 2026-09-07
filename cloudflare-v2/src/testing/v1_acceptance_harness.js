import { signSourcePayload } from '../security/source_auth.js';

const REQUIRED_ENV = [
  'TRADING_V1_ENDPOINT',
  'TRADING_V1_SOURCE_ID',
  'TRADING_V1_SOURCE_SECRET',
];

const SENSITIVE_KEY = /(secret|token|password|credential|authorization|api[_-]?key|signature)/i;
const STALE_TIMESTAMP_OFFSET_MS = -10 * 60 * 1000;

function nonEmpty(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

function cloneAndRedact(value) {
  if (Array.isArray(value)) return value.map(cloneAndRedact);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = cloneAndRedact(child);
  }
  return output;
}

function scenarioEvent({ externalEventId, text, thread = {}, structuredPayload = {}, metadata = {} }) {
  return {
    version: '1.0',
    source: { type: 'custom_webhook', instance_id: 'acceptance-harness' },
    external_event_id: externalEventId,
    occurred_at: new Date().toISOString(),
    text,
    structured_payload: structuredPayload,
    thread,
    metadata: { acceptance_harness: true, ...metadata },
  };
}

export function validateAcceptanceEnvironment(env = {}) {
  const missing = REQUIRED_ENV.filter((name) => !nonEmpty(env[name]));
  return {
    ok: missing.length === 0,
    missing,
    configured: REQUIRED_ENV.filter((name) => !missing.includes(name)),
  };
}

export async function buildSignedV1Request({
  endpoint,
  sourceId,
  secret,
  event,
  timestamp = Date.now(),
} = {}) {
  if (!nonEmpty(endpoint)) throw new TypeError('endpoint required');
  if (!nonEmpty(sourceId)) throw new TypeError('sourceId required');
  if (!nonEmpty(secret)) throw new TypeError('source secret required');
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('event object required');

  const rawBody = JSON.stringify(event);
  const ts = String(timestamp);
  const signature = await signSourcePayload(rawBody, ts, secret);
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Mkety-Source-Id': String(sourceId),
    'X-Mkety-Timestamp': ts,
    'X-Mkety-Signature': signature,
  });

  return {
    rawBody,
    request: new Request(String(endpoint), {
      method: 'POST',
      headers,
      body: rawBody,
    }),
  };
}

export function buildAcceptanceScenario(name, {
  runId = `run-${Date.now()}`,
  duplicateOf = null,
  text = null,
} = {}) {
  const scenario = String(name || '').trim().toLowerCase();

  if (scenario === 'duplicate') {
    if (!duplicateOf?.event) throw new TypeError('duplicateOf scenario required');
    return {
      name: 'duplicate',
      event: structuredClone(duplicateOf.event),
      expectsDuplicate: true,
    };
  }

  const externalEventId = `${runId}:${scenario}`;
  const templates = {
    complete_signal: 'BUY XAUUSD 2500 SL 2490 TP 2510 2520 2530',
    arbitrary_tp: 'BUY XAUUSD 2500 SL 2490 TP1 2510 TP2 2520 TP3 2530 TP4 2540 TP5 2550',
    fast_entry: 'BUY GOLD NOW',
    fast_completion: 'BUY XAUUSD 2500 SL 2490 TP 2510 2520 2530',
    pending_order: 'BUY LIMIT EURUSD 1.1600 SL 1.1570 TP 1.1650',
    ambiguous: 'Gold looks good here, I may buy around this zone with protection below',
    move_be: 'MOVE SL TO BE',
    thread_move_be: 'MOVE SL TO BE',
    close_half: 'CLOSE HALF',
    cancel_pending: 'CANCEL PENDING',
    kill_switch: 'BUY XAUUSD 2500 SL 2490 TP 2510 2520 2530',
    invalid_signature: 'BUY XAUUSD 2500 SL 2490 TP 2510',
    stale_timestamp: 'BUY XAUUSD 2500 SL 2490 TP 2510',
  };
  if (!Object.hasOwn(templates, scenario)) throw new RangeError(`unsupported acceptance scenario: ${scenario}`);

  const result = {
    name: scenario,
    event: scenarioEvent({
      externalEventId,
      text: text || templates[scenario],
      metadata: { acceptance_scenario: scenario, acceptance_run_id: runId },
    }),
    expectsDuplicate: false,
  };

  if (scenario === 'invalid_signature') {
    result.expectedStatus = 401;
    result.requestMutation = 'invalid_signature';
  }
  if (scenario === 'stale_timestamp') {
    result.expectedStatus = 401;
    result.requestMutation = 'stale_timestamp';
    result.timestampOffsetMs = STALE_TIMESTAMP_OFFSET_MS;
  }

  return result;
}

export function sanitizeAcceptanceResult({
  scenario,
  externalEventId,
  requestHeaders = {},
  responseStatus,
  responseBody,
  expectedStatus = null,
} = {}) {
  const headers = requestHeaders instanceof Headers
    ? Object.fromEntries(requestHeaders.entries())
    : { ...requestHeaders };
  const header = (name) => {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry?.[1] ?? null;
  };

  return {
    scenario: scenario ?? null,
    externalEventId: externalEventId ?? null,
    expectedStatus: expectedStatus == null ? null : Number(expectedStatus),
    expectedRejection: expectedStatus != null && Number(expectedStatus) >= 400,
    request: {
      sourceId: header('X-Mkety-Source-Id'),
      timestamp: header('X-Mkety-Timestamp'),
      signature: header('X-Mkety-Signature') ? '[REDACTED]' : null,
    },
    response: {
      statusCode: Number(responseStatus) || 0,
      body: cloneAndRedact(responseBody),
    },
  };
}

export async function runAcceptanceScenario({
  env,
  scenario,
  fetchFn = fetch,
  timestamp = Date.now(),
} = {}) {
  const readiness = validateAcceptanceEnvironment(env);
  if (!readiness.ok) {
    return { ok: false, reason: 'MISSING_ACCEPTANCE_ENV', missing: readiness.missing };
  }
  if (!scenario?.event) throw new TypeError('scenario event required');

  const requestTimestamp = Number(timestamp) + Number(scenario.timestampOffsetMs || 0);
  const built = await buildSignedV1Request({
    endpoint: env.TRADING_V1_ENDPOINT,
    sourceId: env.TRADING_V1_SOURCE_ID,
    secret: env.TRADING_V1_SOURCE_SECRET,
    event: scenario.event,
    timestamp: requestTimestamp,
  });

  let request = built.request;
  if (scenario.requestMutation === 'invalid_signature') {
    const headers = new Headers(request.headers);
    headers.set('X-Mkety-Signature', 'invalid-signature');
    request = new Request(request, { headers });
  }

  const response = await fetchFn(request);
  let responseBody;
  const responseText = await response.text();
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = { nonJsonResponse: true, length: responseText.length };
  }

  const expectedStatus = scenario.expectedStatus == null ? null : Number(scenario.expectedStatus);
  const statusMatched = expectedStatus == null ? response.ok : response.status === expectedStatus;

  return {
    ok: statusMatched,
    result: sanitizeAcceptanceResult({
      scenario: scenario.name,
      externalEventId: scenario.event.external_event_id,
      requestHeaders: request.headers,
      responseStatus: response.status,
      responseBody,
      expectedStatus,
    }),
  };
}
