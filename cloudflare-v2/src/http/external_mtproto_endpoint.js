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

function stableEndpointToken(request) {
  const bearer = String(request.headers.get('Authorization') || '');
  if (/^Bearer\s+/i.test(bearer)) return bearer.replace(/^Bearer\s+/i, '').trim();
  return String(request.headers.get('X-Mkety-Source-Secret') || '').trim();
}

function cleanIdentityPart(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function identityFromPayload(payload) {
  const native = payload?.metadata?.native_identity;
  const nativeChatId = cleanIdentityPart(native?.chat_id);
  const nativeMessageId = cleanIdentityPart(native?.message_id);
  if (nativeChatId && nativeMessageId) return { chat_id: nativeChatId, message_id: nativeMessageId };

  let chatId = cleanIdentityPart(payload?.chat_id ?? payload?.chatId ?? payload?.telegram_chat_id ?? payload?.telegramChatId);
  let messageId = cleanIdentityPart(payload?.message_id ?? payload?.messageId ?? payload?.telegram_message_id ?? payload?.telegramMessageId);

  if (!chatId || !messageId) {
    const eventId = cleanIdentityPart(payload?.external_event_id);
    const match = eventId.match(/^telegram:([^:]+):([^:]+)$/);
    if (match) {
      chatId = chatId || cleanIdentityPart(match[1]);
      messageId = messageId || cleanIdentityPart(match[2]);
    }
  }

  if (!chatId || !messageId) return null;
  return { chat_id: chatId, message_id: messageId };
}

function telegramEventId(chatId, messageId) {
  const id = cleanIdentityPart(messageId);
  return id ? `telegram:${chatId}:${id}` : null;
}

function lineageThread(payload, identity) {
  const existing = payload?.thread && typeof payload.thread === 'object' && !Array.isArray(payload.thread)
    ? payload.thread
    : null;

  const existingReply = cleanIdentityPart(existing?.reply_to_event_id ?? existing?.replyToEventId ?? payload.reply_to_event_id ?? payload.replyToEventId);
  const legacyReplyId = cleanIdentityPart(
    payload.reply_to_id
      ?? payload.reply_to_message_id
      ?? payload.replyToId
      ?? payload.replyToMessageId,
  );
  const replyToEventId = existingReply || telegramEventId(identity.chat_id, legacyReplyId);

  const existingEdited = cleanIdentityPart(existing?.edited_event_id ?? existing?.editedEventId ?? payload.edited_event_id ?? payload.editedEventId);
  const kind = cleanIdentityPart(
    payload.update_kind
      ?? payload.updateKind
      ?? payload.event_type
      ?? payload.eventType
      ?? payload.type
      ?? payload?.metadata?.update_kind
      ?? payload?.metadata?.updateKind,
  ).toLowerCase();
  const hasEditMarker = payload.edited === true
    || payload.is_edited === true
    || payload.isEdited === true
    || payload.is_edit === true
    || payload.isEdit === true
    || Boolean(cleanIdentityPart(payload.edit_date ?? payload.editDate ?? payload.edited_at ?? payload.editedAt))
    || kind.includes('edit');
  const editedEventId = existingEdited || (hasEditMarker
    ? telegramEventId(identity.chat_id, identity.message_id)
    : null);

  if (!existing && !replyToEventId && !editedEventId) return null;
  return {
    ...(existing || {}),
    reply_to_event_id: replyToEventId || null,
    edited_event_id: editedEventId || null,
  };
}

function normalizeExternalMtprotoBody(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return rawBody;
  if (payload.metadata !== undefined && payload.metadata !== null
      && (typeof payload.metadata !== 'object' || Array.isArray(payload.metadata))) {
    return rawBody;
  }

  const identity = identityFromPayload(payload);
  if (!identity) return rawBody;

  const native = payload.metadata?.native_identity;
  const hasCanonicalNativeIdentity = Boolean(cleanIdentityPart(native?.chat_id) && cleanIdentityPart(native?.message_id));
  const hasExternalEventId = Boolean(cleanIdentityPart(payload.external_event_id));
  const thread = lineageThread(payload, identity);
  const hasCanonicalThread = payload.thread && typeof payload.thread === 'object' && !Array.isArray(payload.thread)
    && cleanIdentityPart(payload.thread.reply_to_event_id) === cleanIdentityPart(thread?.reply_to_event_id)
    && cleanIdentityPart(payload.thread.edited_event_id) === cleanIdentityPart(thread?.edited_event_id);

  if (hasCanonicalNativeIdentity && hasExternalEventId && (!thread || hasCanonicalThread)) return rawBody;

  return JSON.stringify({
    ...payload,
    ...(hasExternalEventId ? {} : { external_event_id: `telegram:${identity.chat_id}:${identity.message_id}` }),
    ...(thread ? { thread } : {}),
    metadata: {
      ...(payload.metadata || {}),
      ...(hasCanonicalNativeIdentity ? {} : { native_identity: identity }),
    },
  });
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
  const match = url.pathname.match(/^\/api\/v1\/external\/mtproto\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return json({ ok: false, reason: 'EXTERNAL_MTPROTO_ROUTE_NOT_FOUND' }, 404);

  let sourceId;
  let endpointToken;
  try {
    sourceId = decodeURIComponent(match[1]);
    endpointToken = match[2] ? decodeURIComponent(match[2]) : stableEndpointToken(request);
  } catch {
    return json({ ok: false, reason: 'EXTERNAL_MTPROTO_ENDPOINT_INVALID' }, 400);
  }
  if (!sourceId) return json({ ok: false, reason: 'EXTERNAL_MTPROTO_ENDPOINT_INVALID' }, 400);

  let source;
  try {
    source = await resolveActiveSource(sourceId, env);
  } catch {
    return json({ ok: false, reason: 'SOURCE_RUNTIME_UNAVAILABLE' }, 503);
  }

  if (!source?.id || source.provider_type !== 'external_mtproto' || !source.secret) {
    return json({ ok: false, reason: 'UNKNOWN_OR_INACTIVE_SOURCE' }, 404);
  }
  if (endpointToken && !constantTimeEqual(endpointToken, source.secret)) {
    return json({ ok: false, reason: 'INVALID_EXTERNAL_MTPROTO_ENDPOINT' }, 401);
  }

  let rawBody;
  try {
    rawBody = normalizeExternalMtprotoBody(await request.text());
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
