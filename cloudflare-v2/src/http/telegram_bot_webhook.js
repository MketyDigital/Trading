import { decryptSecret as decryptStoredSecret } from '../security/secret_box.js';
import { createSourceConnectionStore } from '../sources/source_connection_store.js';
import { createSourceEventQueue } from '../sources/source_event_queue.js';

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

function text(value) {
  return String(value ?? '').trim();
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function handleFromRequest(request) {
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/webhooks\/telegram-bot\/([^/]+)$/);
  if (!match) return null;
  try {
    return text(decodeURIComponent(match[1])) || null;
  } catch {
    return null;
  }
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left ?? ''));
  const b = new TextEncoder().encode(String(right ?? ''));
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function sourceField(source, camel, snake) {
  return source?.[camel] ?? source?.[snake] ?? null;
}

function sourceProvider(source) {
  return text(sourceField(source, 'providerType', 'provider_type'));
}

function sourceFamily(source) {
  return text(sourceField(source, 'sourceFamily', 'source_family'));
}

function sourceSecretCiphertext(source) {
  return sourceField(source, 'secretCiphertext', 'secret_ciphertext');
}

function allowedChatIds(source) {
  const config = source?.config && typeof source.config === 'object' && !Array.isArray(source.config) ? source.config : {};
  const configured = Array.isArray(config.chat_ids)
    ? config.chat_ids
    : Array.isArray(config.allowed_chat_ids) ? config.allowed_chat_ids : [];
  return new Set(configured.map((value) => text(value)).filter(Boolean));
}

function telegramMessage(update = {}) {
  for (const kind of ['message', 'edited_message', 'channel_post', 'edited_channel_post']) {
    const message = update?.[kind];
    if (message && typeof message === 'object' && !Array.isArray(message)) return { kind, message };
  }
  return null;
}

function occurredAt(message, nowMs) {
  const seconds = Number(message?.edit_date ?? message?.date);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000).toISOString();
  return new Date(Number(nowMs())).toISOString();
}

function nativeEventFromUpdate(update, extracted, nowMs) {
  const { kind, message } = extracted;
  const chatId = text(message?.chat?.id);
  const messageId = text(message?.message_id);
  const body = String(message?.text ?? message?.caption ?? '').trim();
  if (!chatId || !messageId) return { ok: false, reason: 'TELEGRAM_BOT_NATIVE_IDENTITY_REQUIRED' };
  if (!body) return { ok: true, ignored: true, reason: 'TELEGRAM_BOT_EMPTY_MESSAGE' };

  const replyTo = text(message?.reply_to_message?.message_id);
  return {
    ok: true,
    event: {
      source_external_id: chatId,
      external_event_id: `${chatId}:${messageId}`,
      occurred_at: occurredAt(message, nowMs),
      text: body,
      structured_payload: {},
      thread: replyTo ? { reply_to_message_id: replyTo } : {},
      metadata: {
        telegram_update_id: update?.update_id ?? null,
        telegram_update_kind: kind,
        telegram_chat_type: message?.chat?.type ?? null,
        telegram_from_id: message?.from?.id ?? message?.sender_chat?.id ?? null,
        native_identity: {
          chat_id: chatId,
          message_id: messageId,
        },
      },
    },
  };
}

async function defaultSupabaseFactory(env = {}) {
  const url = text(env?.SUPABASE_URL);
  const key = text(env?.SUPABASE_SERVICE_ROLE ?? env?.SUPABASE_SERVICE_ROLE_KEY ?? env?.SUPABASE_SERVICE_KEY);
  if (!url || !key) throw new Error('Trading database is unavailable');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveDefaultSourceStore(env, supabaseFactory) {
  return createSourceConnectionStore(await supabaseFactory(env));
}

function defaultQueue(env = {}) {
  return createSourceEventQueue({ queue: env?.SOURCE_EVENT_QUEUE });
}

export async function handleTelegramBotWebhookRequest(request, env = {}, {
  sourceStore = null,
  sourceQueue = null,
  enqueueSourceEvent = null,
  decryptSecret = decryptStoredSecret,
  supabaseFactory = defaultSupabaseFactory,
  nowMs = () => Date.now(),
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  if (!env?.TRADING_MASTER_KEY) return json({ ok: false, reason: 'TRADING_MASTER_KEY_NOT_CONFIGURED' }, 503);

  const handle = handleFromRequest(request);
  if (!handle) return json({ ok: false, reason: 'TELEGRAM_BOT_SOURCE_NOT_FOUND' }, 404);

  const limit = Math.max(1024, Number(maxBodyBytes) || DEFAULT_MAX_BODY_BYTES);
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > limit) return json({ ok: false, reason: 'TELEGRAM_BOT_BODY_TOO_LARGE' }, 413);

  let store;
  let source;
  try {
    store = sourceStore || await resolveDefaultSourceStore(env, supabaseFactory);
    if (typeof store?.getActiveTelegramBotSourceByPublicHandle === 'function') {
      source = await store.getActiveTelegramBotSourceByPublicHandle(handle);
    } else if (typeof store?.getByPublicHandle === 'function') {
      source = await store.getByPublicHandle(handle);
    }
  } catch {
    return json({ ok: false, reason: 'TELEGRAM_BOT_SOURCE_UNAVAILABLE' }, 503);
  }
  if (!source?.id || sourceProvider(source) !== 'telegram_bot_api' || sourceFamily(source) !== 'telegram') {
    return json({ ok: false, reason: 'TELEGRAM_BOT_SOURCE_NOT_FOUND' }, 404);
  }

  const ciphertext = sourceSecretCiphertext(source);
  if (!ciphertext) return json({ ok: false, reason: 'TELEGRAM_BOT_SOURCE_SECRET_UNAVAILABLE' }, 503);

  let expectedSecret;
  try {
    expectedSecret = await decryptSecret(ciphertext, env.TRADING_MASTER_KEY);
  } catch {
    return json({ ok: false, reason: 'TELEGRAM_BOT_SOURCE_SECRET_UNAVAILABLE' }, 503);
  }
  const presentedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!presentedSecret || !constantTimeEqual(expectedSecret, presentedSecret)) {
    return json({ ok: false, reason: 'TELEGRAM_BOT_WEBHOOK_UNAUTHORIZED' }, 401);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, reason: 'TELEGRAM_BOT_INVALID_UPDATE' }, 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > limit) return json({ ok: false, reason: 'TELEGRAM_BOT_BODY_TOO_LARGE' }, 413);

  let update;
  try {
    update = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, reason: 'TELEGRAM_BOT_INVALID_UPDATE' }, 400);
  }
  if (!update || typeof update !== 'object' || Array.isArray(update)) return json({ ok: false, reason: 'TELEGRAM_BOT_INVALID_UPDATE' }, 400);

  const extracted = telegramMessage(update);
  if (!extracted) return json({ ok: true, ignored: true, reason: 'TELEGRAM_BOT_UPDATE_NOT_MESSAGE' }, 200);

  const native = nativeEventFromUpdate(update, extracted, nowMs);
  if (!native.ok) return json({ ok: false, reason: native.reason }, 400);
  if (native.ignored) return json({ ok: true, ignored: true, reason: native.reason }, 200);

  const chatId = text(native.event.metadata?.native_identity?.chat_id);
  const allowed = allowedChatIds(source);
  if (allowed.size === 0) return json({ ok: false, reason: 'TELEGRAM_BOT_CHAT_POLICY_NOT_CONFIGURED' }, 403);
  if (!allowed.has(chatId)) return json({ ok: false, reason: 'TELEGRAM_BOT_CHAT_NOT_AUTHORIZED' }, 403);

  try {
    if (typeof enqueueSourceEvent === 'function') {
      await enqueueSourceEvent(source, native.event);
    } else {
      const queue = sourceQueue || defaultQueue(env);
      await queue.enqueueSourceEvent(source, native.event);
    }
  } catch {
    return json({ ok: false, reason: 'TELEGRAM_BOT_QUEUE_UNAVAILABLE' }, 503);
  }

  return json({ ok: true, queued: true }, 200);
}
