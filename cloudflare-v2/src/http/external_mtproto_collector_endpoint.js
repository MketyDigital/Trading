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

function clean(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function tokenFromRequest(request, url) {
  const pathMatch = url.pathname.match(/^\/api\/v1\/external\/mtproto\/collect\/([^/]+)$/);
  if (pathMatch) {
    try { return decodeURIComponent(pathMatch[1]).trim(); } catch { return ''; }
  }
  const bearer = clean(request.headers.get('Authorization'));
  if (/^Bearer\s+/i.test(bearer)) return bearer.replace(/^Bearer\s+/i, '').trim();
  return clean(request.headers.get('X-Mkety-Collector-Token'));
}

function identityFromPayload(payload = {}) {
  const native = payload?.metadata?.native_identity;
  const chatId = clean(native?.chat_id ?? payload.chat_id ?? payload.chatId ?? payload.telegram_chat_id ?? payload.telegramChatId);
  const messageId = clean(native?.message_id ?? payload.message_id ?? payload.messageId ?? payload.telegram_message_id ?? payload.telegramMessageId);
  if (chatId && messageId) return { chat_id: chatId, message_id: messageId };
  const externalEventId = clean(payload.external_event_id);
  const match = externalEventId.match(/^telegram:([^:]+):([^:]+)$/);
  if (!match) return null;
  return { chat_id: chatId || clean(match[1]), message_id: messageId || clean(match[2]) };
}

function normalizePayload(rawBody) {
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const identity = identityFromPayload(payload);
  if (!identity?.chat_id || !identity?.message_id) return null;
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
    ? payload.metadata
    : {};
  return {
    payload: {
      ...payload,
      external_event_id: clean(payload.external_event_id) || `telegram:${identity.chat_id}:${identity.message_id}`,
      metadata: {
        ...metadata,
        native_identity: {
          chat_id: identity.chat_id,
          message_id: identity.message_id,
        },
      },
    },
    identity,
  };
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function defaultSupabase(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('COLLECTOR_RUNTIME_UNAVAILABLE');
  return createClient(url, key);
}

async function defaultResolveCollector(token, env = {}) {
  const supabase = await defaultSupabase(env);
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase
    .from('trading_ingress_collectors')
    .select('id,collector_name,metadata,is_active')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data?.id) return null;
  await supabase.from('trading_ingress_collectors').update({ last_seen_at: new Date().toISOString() }).eq('id', data.id);
  return data;
}

async function defaultResolveSourcesForChat(chatId, collector, env = {}) {
  const supabase = await defaultSupabase(env);
  const masterKey = env.TRADING_MASTER_KEY;
  if (!masterKey) throw new Error('SOURCE_RUNTIME_UNAVAILABLE');
  const stores = createSupabaseIngestStores(supabase, { masterKey });
  return stores.sourceStore.findActiveExternalMtprotoSourcesForChat(chatId, {
    externalIdentity: clean(collector?.metadata?.external_identity ?? collector?.metadata?.externalIdentity) || null,
  });
}

export async function handleExternalMtprotoCollectorRequest(request, env = {}, {
  resolveCollector = defaultResolveCollector,
  resolveSourcesForChat = defaultResolveSourcesForChat,
  eventsHandler = handleV1EventsRequest,
  nowMs = Date.now,
  ctx,
} = {}) {
  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  const url = new URL(request.url);
  if (!/^\/api\/v1\/external\/mtproto\/collect(?:\/[^/]+)?$/.test(url.pathname)) {
    return json({ ok: false, reason: 'EXTERNAL_MTPROTO_COLLECTOR_ROUTE_NOT_FOUND' }, 404);
  }

  const token = tokenFromRequest(request, url);
  if (!token) return json({ ok: false, reason: 'EXTERNAL_MTPROTO_COLLECTOR_AUTH_REQUIRED' }, 401);

  let collector;
  try { collector = await resolveCollector(token, env); }
  catch { return json({ ok: false, reason: 'COLLECTOR_RUNTIME_UNAVAILABLE' }, 503); }
  if (!collector?.id) return json({ ok: false, reason: 'INVALID_EXTERNAL_MTPROTO_COLLECTOR' }, 401);

  let normalized;
  try { normalized = normalizePayload(await request.text()); }
  catch { normalized = null; }
  if (!normalized) return json({ ok: false, reason: 'EXTERNAL_MTPROTO_NATIVE_IDENTITY_REQUIRED' }, 400);

  let sources;
  try { sources = await resolveSourcesForChat(normalized.identity.chat_id, collector, env); }
  catch { return json({ ok: false, reason: 'SOURCE_RUNTIME_UNAVAILABLE' }, 503); }
  const matched = Array.isArray(sources) ? sources : [];
  if (matched.length === 0) {
    return json({
      ok: true,
      accepted: true,
      ignored: true,
      chatId: normalized.identity.chat_id,
      matchedSources: 0,
      deliveredSources: 0,
    }, 202);
  }

  const rawBody = JSON.stringify(normalized.payload);
  const timestamp = String(Number(nowMs()));
  const results = [];
  for (const source of matched) {
    if (!source?.id || !source?.secret || source.provider_type !== 'external_mtproto') continue;
    let signature;
    try { signature = await signSourcePayload(rawBody, timestamp, source.secret); }
    catch {
      results.push({ sourceId: source.id, ok: false, status: 500 });
      continue;
    }
    const headers = new Headers();
    headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json; charset=utf-8');
    headers.set('X-Mkety-Source-Id', source.id);
    headers.set('X-Mkety-Timestamp', timestamp);
    headers.set('X-Mkety-Signature', signature);
    const signedRequest = new Request(`${url.origin}/api/v1/events`, { method: 'POST', headers, body: rawBody });
    try {
      const response = await eventsHandler(signedRequest, env, { ctx });
      results.push({ sourceId: source.id, ok: Boolean(response?.ok), status: Number(response?.status || 0) });
    } catch {
      results.push({ sourceId: source.id, ok: false, status: 500 });
    }
  }

  const deliveredSources = results.filter((item) => item.ok).length;
  const failedSources = results.filter((item) => !item.ok).length;
  if (failedSources > 0) {
    return json({
      ok: false,
      reason: 'EXTERNAL_MTPROTO_COLLECTOR_PARTIAL_DELIVERY',
      accepted: true,
      chatId: normalized.identity.chat_id,
      matchedSources: matched.length,
      deliveredSources,
      failedSources,
    }, 502);
  }

  return json({
    ok: true,
    accepted: true,
    ignored: false,
    chatId: normalized.identity.chat_id,
    matchedSources: matched.length,
    deliveredSources,
  }, 202);
}
