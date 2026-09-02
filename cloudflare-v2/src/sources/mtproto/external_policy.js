const EXTERNAL_MTPROTO_PROVIDER = 'external_mtproto';
const ALLOWLIST_MODE = 'allowlist';
const ALL_VISIBLE_MODE = 'all_visible';

function reject(status, reason) {
  return { ok: false, status, reason };
}

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function authorizeExternalMtprotoEvent({ source, input } = {}) {
  if (source?.provider_type !== EXTERNAL_MTPROTO_PROVIDER) {
    return { ok: true };
  }

  const accountScope = clean(source.external_identity);
  if (source.source_family !== 'telegram' || !accountScope) {
    return reject(400, 'MTPROTO_SOURCE_POLICY_INVALID');
  }

  const nativeIdentity = input?.metadata?.native_identity;
  const chatId = clean(nativeIdentity?.chat_id);
  const messageId = clean(nativeIdentity?.message_id);
  if (!chatId || !messageId) {
    return reject(400, 'MTPROTO_NATIVE_IDENTITY_REQUIRED');
  }

  if (input?.metadata && hasOwn(input.metadata, 'account_scope')) {
    const callerScope = clean(input.metadata.account_scope);
    if (callerScope !== accountScope) {
      return reject(403, 'MTPROTO_ACCOUNT_SCOPE_MISMATCH');
    }
  }

  if (source.config !== null && source.config !== undefined
      && (typeof source.config !== 'object' || Array.isArray(source.config))) {
    return reject(400, 'MTPROTO_SOURCE_POLICY_INVALID');
  }

  const config = source.config || {};
  const mode = clean(config.chat_acceptance_mode) || ALLOWLIST_MODE;
  if (mode !== ALLOWLIST_MODE && mode !== ALL_VISIBLE_MODE) {
    return reject(400, 'MTPROTO_SOURCE_POLICY_INVALID');
  }

  if (config.allowed_chat_ids !== null && config.allowed_chat_ids !== undefined
      && !Array.isArray(config.allowed_chat_ids)) {
    return reject(400, 'MTPROTO_SOURCE_POLICY_INVALID');
  }

  if (mode === ALL_VISIBLE_MODE) {
    return { ok: true };
  }

  const allowedChatIds = new Set(
    (config.allowed_chat_ids || [])
      .map(clean)
      .filter(Boolean),
  );

  if (!allowedChatIds.has(chatId)) {
    return reject(403, 'MTPROTO_CHAT_NOT_AUTHORIZED');
  }

  return { ok: true };
}
