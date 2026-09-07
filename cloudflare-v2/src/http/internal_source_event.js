import { createSourceEventQueue } from '../sources/source_event_queue.js';

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeString(value) {
  return value == null ? '' : String(value);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function equalToken(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function normalizeTelegramNativeEvent(input) {
  if (!isPlainObject(input)) throw new TypeError('INVALID_SOURCE_EVENT');

  const sourceId = safeString(input.source_id).trim();
  const sourceExternalId = safeString(input.source_external_id).trim();
  const externalEventId = safeString(input.external_event_id).trim();
  const metadata = isPlainObject(input.metadata) ? input.metadata : {};
  const nativeIdentity = isPlainObject(metadata.native_identity) ? metadata.native_identity : {};
  const chatId = safeString(nativeIdentity.chat_id).trim();
  const messageId = safeString(nativeIdentity.message_id).trim();

  if (!sourceId || !sourceExternalId || !externalEventId || !chatId || !messageId) {
    throw new TypeError('INVALID_SOURCE_EVENT');
  }
  if (externalEventId !== `telegram:${chatId}:${messageId}`) {
    throw new TypeError('INVALID_SOURCE_EVENT');
  }

  return {
    sourceId,
    event: {
      source_external_id: sourceExternalId,
      external_event_id: externalEventId,
      occurred_at: input.occurred_at == null ? null : String(input.occurred_at),
      text: String(input.text ?? ''),
      structured_payload: isPlainObject(input.structured_payload) ? input.structured_payload : {},
      thread: isPlainObject(input.thread) ? input.thread : {},
      metadata: {
        ...metadata,
        native_identity: {
          chat_id: chatId,
          message_id: messageId,
        },
      },
    },
  };
}

export async function handleInternalSourceEventRequest(request, env = {}) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, reason: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST' });
  }

  const configuredToken = env.INTERNAL_SOURCE_TRANSPORT_TOKEN;
  const suppliedToken = request.headers.get('X-Mkety-Internal-Source-Token');
  if (!configuredToken || !(await equalToken(suppliedToken, configuredToken))) {
    return json(401, { ok: false, reason: 'UNAUTHORIZED' });
  }

  if (!env.SOURCE_EVENT_QUEUE?.send) {
    return json(503, { ok: false, reason: 'SOURCE_QUEUE_UNAVAILABLE' });
  }

  let normalized;
  try {
    const payload = await request.json();
    normalized = normalizeTelegramNativeEvent(payload);
  } catch {
    return json(400, { ok: false, reason: 'INVALID_SOURCE_EVENT' });
  }

  try {
    const queue = createSourceEventQueue({ queue: env.SOURCE_EVENT_QUEUE });
    await queue.enqueueSourceEvent({ id: normalized.sourceId }, normalized.event);
    return json(202, { ok: true, queued: true });
  } catch (error) {
    console.warn('Internal source handoff queue unavailable:', error?.message || error);
    return json(503, { ok: false, reason: 'SOURCE_QUEUE_UNAVAILABLE' });
  }
}
