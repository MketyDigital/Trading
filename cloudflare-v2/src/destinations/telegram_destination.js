const ALLOWED_PARSE_MODES = new Set(['HTML', 'Markdown', 'MarkdownV2']);
const DEFAULT_TIMEOUT_MS = 5000;

function text(value) {
  return String(value ?? '').trim();
}

function boundedTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(100, Math.min(parsed, 15000));
}

function sanitizeProviderDescription(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}

function failure(errorCode, status = 0, extra = {}) {
  return { ok: false, status: Number(status) || 0, errorCode, ...extra };
}

function safeEntities(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({ ...item }))
    : [];
}

async function telegramRejection(response, status, errorCode = 'TELEGRAM_SEND_REJECTED') {
  try {
    const payload = await response.json();
    const providerCode = Number(payload?.error_code);
    const retryAfter = Number(payload?.parameters?.retry_after);
    return failure(errorCode, status, {
      ...(Number.isInteger(providerCode) ? { providerCode } : {}),
      ...(sanitizeProviderDescription(payload?.description) ? { providerDescription: sanitizeProviderDescription(payload.description) } : {}),
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
    });
  } catch {
    return failure(errorCode, status);
  }
}

function validateCommonInput({ botToken, chatId, messageText, parseMode, entities, fetchFn }) {
  const token = text(botToken);
  const target = text(chatId);
  const message = String(messageText ?? '');
  const mode = text(parseMode) || 'plain';
  const nativeEntities = safeEntities(entities);

  if (!token) return { error: failure('TELEGRAM_BOT_TOKEN_REQUIRED') };
  if (!target) return { error: failure('TELEGRAM_CHAT_ID_REQUIRED') };
  if (!message.trim()) return { error: failure('TELEGRAM_MESSAGE_REQUIRED') };
  if (mode !== 'plain' && !ALLOWED_PARSE_MODES.has(mode)) return { error: failure('TELEGRAM_PARSE_MODE_UNSUPPORTED') };
  if (nativeEntities.length && mode !== 'plain') return { error: failure('TELEGRAM_ENTITIES_PARSE_MODE_CONFLICT') };
  if (typeof fetchFn !== 'function') return { error: failure('TELEGRAM_TRANSPORT_UNAVAILABLE') };

  return { token, target, message, mode, nativeEntities };
}

export async function sendTelegramDestination({
  botToken,
  chatId,
  text: messageText,
  parseMode = 'plain',
  entities = null,
  replyToMessageId = null,
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const validated = validateCommonInput({ botToken, chatId, messageText, parseMode, entities, fetchFn });
  if (validated.error) return validated.error;
  const { token, target, message, mode, nativeEntities } = validated;
  const replyId = Number(replyToMessageId);

  if (replyToMessageId != null && (!Number.isInteger(replyId) || replyId <= 0)) return failure('TELEGRAM_REPLY_MESSAGE_ID_INVALID');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    const body = {
      chat_id: target,
      text: message,
      disable_web_page_preview: true,
    };
    if (nativeEntities.length) body.entities = nativeEntities;
    else if (mode !== 'plain') body.parse_mode = mode;
    if (replyToMessageId != null) {
      body.reply_parameters = { message_id: replyId, allow_sending_without_reply: false };
    }

    const response = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const status = Number(response?.status || 0);
    if (!response?.ok) return telegramRejection(response, status);

    let payload;
    try {
      payload = await response.json();
    } catch {
      return failure('TELEGRAM_RESPONSE_INVALID', status);
    }
    if (payload?.ok !== true || payload?.result?.message_id == null) {
      return failure('TELEGRAM_RESPONSE_INVALID', status, {
        ...(Number.isInteger(Number(payload?.error_code)) ? { providerCode: Number(payload.error_code) } : {}),
        ...(sanitizeProviderDescription(payload?.description) ? { providerDescription: sanitizeProviderDescription(payload.description) } : {}),
      });
    }

    return {
      ok: true,
      messageId: payload.result.message_id,
      status,
    };
  } catch (error) {
    if (error?.name === 'AbortError') return failure('TELEGRAM_SEND_TIMEOUT');
    return failure('TELEGRAM_TRANSPORT_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

export async function editTelegramDestination({
  botToken,
  chatId,
  messageId,
  text: messageText,
  parseMode = 'plain',
  entities = null,
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const validated = validateCommonInput({ botToken, chatId, messageText, parseMode, entities, fetchFn });
  if (validated.error) return validated.error;
  const { token, target, message, mode, nativeEntities } = validated;
  const editMessageId = Number(messageId);
  if (!Number.isInteger(editMessageId) || editMessageId <= 0) return failure('TELEGRAM_EDIT_MESSAGE_ID_INVALID');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
  try {
    const body = {
      chat_id: target,
      message_id: editMessageId,
      text: message,
      disable_web_page_preview: true,
    };
    if (nativeEntities.length) body.entities = nativeEntities;
    else if (mode !== 'plain') body.parse_mode = mode;

    const response = await fetchFn(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const status = Number(response?.status || 0);
    if (!response?.ok) return telegramRejection(response, status, 'TELEGRAM_EDIT_REJECTED');

    let payload;
    try {
      payload = await response.json();
    } catch {
      return failure('TELEGRAM_EDIT_RESPONSE_INVALID', status);
    }
    if (payload?.ok !== true || payload?.result?.message_id == null) {
      return failure('TELEGRAM_EDIT_RESPONSE_INVALID', status, {
        ...(Number.isInteger(Number(payload?.error_code)) ? { providerCode: Number(payload.error_code) } : {}),
        ...(sanitizeProviderDescription(payload?.description) ? { providerDescription: sanitizeProviderDescription(payload.description) } : {}),
      });
    }

    return {
      ok: true,
      messageId: payload.result.message_id,
      status,
      edited: true,
    };
  } catch (error) {
    if (error?.name === 'AbortError') return failure('TELEGRAM_EDIT_TIMEOUT');
    return failure('TELEGRAM_EDIT_TRANSPORT_FAILED');
  } finally {
    clearTimeout(timer);
  }
}
