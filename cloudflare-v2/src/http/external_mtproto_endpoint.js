import { createClient } from '@supabase/supabase-js';
import { createSupabaseIngestStores } from '../storage/supabase_ingest_store.js';
import { signSourcePayload } from '../security/source_auth.js';
import { handleV1EventsRequest } from './v1_events.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function constantTimeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function defaultResolveActiveSource(sourceId, env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  const masterKey = env.TRADING_MASTER_KEY;
  if (!url || !key || !masterKey) throw new Error('SOURCE_RUNTIME_UNAVAILABLE');
  const supabase = createClient(url, key);
  const stores = createSupabaseIngestStores(supabase, { masterKey });
  return stores.sourceStore.getActiveSource(sourceId);
}

export async function handleExternalMtprotoEndpointRequest(request, env = {}, {
  resolveActiveSource = defaultResolveActiveSource,
  eventsHandler = handleV1EventsRequest,
  nowMs = Date.now,
  ctx,
} = {}) {
  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/external\/mtproto\/([^/]+)\/([^/]+)$/);
  if (!match) return json({ ok: false, reason: 'EXTERNAL_MTPROTO_ROUTE_NOT_FOUND' }, 404);

  let sourceId;
  let endpointToken;
  try {
    sourceId = decodeURIComponent(match[1]);
    endpointToken = decodeURIComponent(match[2]);
  } catch {
    return json({ ok: false, reason: 'EXTERNAL_MTPROTO_ENDPOINT_INVALID' }, 400);
  }
  if (!sourceId || !endpointToken) return json({ ok: false, reason: 'EXTERNAL_MTPROTO_ENDPOINT_INVALID' }, 400);

  let source;
  try {
    source = await resolveActiveSource(sourceId, env);
  } catch {
    return json({ ok: false, reason: 'SOURCE_RUNTIME_UNAVAILABLE' }, 503);
  }

  if (!source?.id || source.provider_type !== 'external_mtproto' || !source.secret) {
    return json({ ok: false, reason: 'UNKNOWN_OR_INACTIVE_SOURCE' }, 404);
  }
  if (!constantTimeEqual(endpointToken, source.secret)) {
    return json({ ok: false, reason: 'INVALID_EXTERNAL_MTPROTO_ENDPOINT' }, 401);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, reason: 'INVALID_REQUEST_BODY' }, 400);
  }

  const timestamp = String(Number(nowMs()));
  let signature;
  try {
    signature = await signSourcePayload(rawBody, timestamp, source.secret);
  } catch {
    return json({ ok: false, reason: 'SOURCE_AUTH_INTERNAL_ERROR' }, 500);
  }

  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json; charset=utf-8');
  headers.set('X-Mkety-Source-Id', source.id);
  headers.set('X-Mkety-Timestamp', timestamp);
  headers.set('X-Mkety-Signature', signature);

  const signedRequest = new Request(`${url.origin}/api/v1/events`, {
    method: 'POST',
    headers,
    body: rawBody,
  });

  return eventsHandler(signedRequest, env, { ctx });
}
