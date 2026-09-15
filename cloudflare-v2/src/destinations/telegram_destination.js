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

function failure(errorCode, status = 0) {
  return { ok: false, status: Number(status) || 0, errorCode };
}

function safeEntities(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => ({ ...item }))
    : [];
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
  const token = text(botToken);
  const target = text(chatId);
  const message = String(messageText ?? '');
  const mode = text(parseMode) || 'plain';
  const nativeEntities = safeEntities(entities);
  const replyId = Number(replyToMessageId);

  if (!token) return failure('TELEGRAM_BOT_TOKEN_REQUIRED');
  if (!target) return failure('TELEGRAM_CHAT_ID_REQUIRED');
  if (!message.trim()) return failure('TELEGRAM_MESSAGE_REQUIRED');
  if (mode !== 'plain' && !ALLOWED_PARSE_MODES.has(mode)) return failure('TELEGRAM_PARSE_MODE_UNSUPPORTED');
  if (nativeEntities.length && mode !== 'plain') return failure('TELEGRAM_ENTITIES_PARSE_MODE_CONFLICT');
  if (replyToMessageId != null && (!Number.isInteger(replyId) || replyId <= 0)) return failure('TELEGRAM_REPLY_MESSAGE_ID_INVALID');
  if (typeof fetchFn !== 'function') return failure('TELEGRAM_TRANSPORT_UNAVAILABLE');

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
    if (!response?.ok) return failure('TELEGRAM_SEND_REJECTED', status);

    let payload;
    try {
      payload = await response.json();
    } catch {
      return failure('TELEGRAM_RESPONSE_INVALID', status);
    }
    if (payload?.ok !== true || payload?.result?.message_id == null) {
      return failure('TELEGRAM_RESPONSE_INVALID', status);
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
