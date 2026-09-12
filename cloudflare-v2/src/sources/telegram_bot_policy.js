const TELEGRAM_BOT_PROVIDER = 'telegram_bot_api';

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function reject(status, reason) {
  return { ok: false, status, reason };
}

export function authorizeTelegramBotEvent({ source, input } = {}) {
  if (source?.provider_type !== TELEGRAM_BOT_PROVIDER) return { ok: true };

  if (source.source_family !== 'telegram') {
    return reject(400, 'TELEGRAM_BOT_SOURCE_POLICY_INVALID');
  }

  const config = source.config;
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.chat_ids)) {
    return reject(400, 'TELEGRAM_BOT_SOURCE_POLICY_INVALID');
  }

  const nativeIdentity = input?.metadata?.native_identity;
  const chatId = clean(nativeIdentity?.chat_id);
  const messageId = clean(nativeIdentity?.message_id);
  if (!chatId || !messageId) {
    return reject(400, 'TELEGRAM_BOT_NATIVE_IDENTITY_REQUIRED');
  }

  const allowedChatIds = new Set(config.chat_ids.map(clean).filter(Boolean));
  if (!allowedChatIds.has(chatId)) {
    return reject(403, 'TELEGRAM_BOT_CHAT_NOT_AUTHORIZED');
  }

  return { ok: true };
}
