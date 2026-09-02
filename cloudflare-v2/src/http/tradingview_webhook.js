import { verifyTradingViewTransport } from '../security/tradingview_transport.js';
import { createSourceConnectionStore } from '../sources/source_connection_store.js';
import { createSourceEventQueue } from '../sources/source_event_queue.js';

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const FORBIDDEN_KEY = /(workspace|source(?:_connection)?(?:_id)?|destination|broker|execution|secret|token|password|credential|authorization|api[_-]?key|private[_-]?key)/i;

function response(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    output[key] = sanitize(child);
  }
  return output;
}

function nonEmptyObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0);
}

function publicHandleFromRequest(request) {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/api\/v1\/webhooks\/tradingview\/([^/]+)$/);
  if (!match) return null;
  try {
    const handle = decodeURIComponent(match[1]).trim();
    return handle || null;
  } catch {
    return null;
  }
}

async function defaultSupabaseFactory(env = {}) {
  const url = String(env?.SUPABASE_URL ?? '').trim();
  const key = String(
    env?.SUPABASE_SERVICE_ROLE
      ?? env?.SUPABASE_SERVICE_ROLE_KEY
      ?? env?.SUPABASE_SERVICE_KEY
      ?? '',
  ).trim();
  if (!url || !key) throw new Error('Trading database is unavailable');

  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function defaultSourceStore(env, supabaseFactory) {
  const supabase = await supabaseFactory(env);
  return createSourceConnectionStore(supabase);
}

function defaultSourceQueue(env = {}) {
  return createSourceEventQueue({ queue: env?.SOURCE_EVENT_QUEUE });
}

export async function handleTradingViewWebhookRequest(request, env = {}, {
  verifyTransport = verifyTradingViewTransport,
  sourceStore = null,
  sourceQueue = null,
  supabaseFactory = defaultSupabaseFactory,
  nowMs = () => Date.now(),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  if (request.method !== 'POST') {
    return response({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }

  const transport = verifyTransport(request, env);
  if (!transport?.ok) {
    return response({ ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' }, 403);
  }

  const handle = publicHandleFromRequest(request);
  if (!handle) return response({ ok: false, reason: 'TRADINGVIEW_SOURCE_NOT_FOUND' }, 404);

  const maxBytes = Number.isFinite(Number(maxBodyBytes)) && Number(maxBodyBytes) > 0
    ? Number(maxBodyBytes)
    : DEFAULT_MAX_BODY_BYTES;
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return response({ ok: false, reason: 'TRADINGVIEW_BODY_TOO_LARGE' }, 413);
  }

  let store;
  let source;
  try {
    store = sourceStore || await defaultSourceStore(env, supabaseFactory);
    source = await store.getActiveTradingViewSourceByPublicHandle(handle);
  } catch {
    return response({ ok: false, reason: 'TRADINGVIEW_SOURCE_UNAVAILABLE' }, 503);
  }
  if (!source?.id) return response({ ok: false, reason: 'TRADINGVIEW_SOURCE_NOT_FOUND' }, 404);

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return response({ ok: false, reason: 'TRADINGVIEW_INVALID_EVENT' }, 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    return response({ ok: false, reason: 'TRADINGVIEW_BODY_TOO_LARGE' }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return response({ ok: false, reason: 'TRADINGVIEW_INVALID_EVENT' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return response({ ok: false, reason: 'TRADINGVIEW_INVALID_EVENT' }, 400);
  }

  const eventId = String(payload.event_id ?? '').trim();
  const text = String(payload.text ?? '').trim();
  const structuredPayload = sanitize(
    payload.structured_payload && typeof payload.structured_payload === 'object' && !Array.isArray(payload.structured_payload)
      ? payload.structured_payload
      : {},
  );
  if (!eventId || (!text && !nonEmptyObject(structuredPayload))) {
    return response({ ok: false, reason: 'TRADINGVIEW_INVALID_EVENT' }, 400);
  }

  const metadata = sanitize(
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {},
  );
  metadata.native_identity = { event_id: eventId };

  const occurredAt = payload.occurred_at == null || String(payload.occurred_at).trim() === ''
    ? new Date(Number(nowMs())).toISOString()
    : String(payload.occurred_at).trim();

  const event = {
    source_external_id: source.externalIdentity ?? source.external_identity ?? null,
    external_event_id: eventId,
    occurred_at: occurredAt,
    text,
    structured_payload: structuredPayload,
    thread: {},
    metadata,
  };

  try {
    const queue = sourceQueue || defaultSourceQueue(env);
    await queue.enqueueSourceEvent(source, event);
  } catch {
    return response({ ok: false, reason: 'TRADINGVIEW_QUEUE_UNAVAILABLE' }, 503);
  }

  return response({ ok: true, queued: true }, 202);
}
