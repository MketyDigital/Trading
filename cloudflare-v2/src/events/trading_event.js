function stringOrNull(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function telegramChatId(input = {}, source = {}, externalEventId = null) {
  const native = input?.metadata?.native_identity?.chat_id;
  if (native !== undefined && native !== null && String(native).trim()) return String(native).trim();
  if (String(source?.type || '').toLowerCase().startsWith('telegram') && source?.external_id) {
    return String(source.external_id).trim();
  }
  const match = String(externalEventId || '').match(/^telegram:(.+):[^:]+$/);
  return match ? match[1] : null;
}

function canonicalTelegramEventId(value, chatId) {
  const candidate = stringOrNull(value);
  if (!candidate) return null;
  if (candidate.startsWith('telegram:')) return candidate;
  if (chatId && /^-?\d+$/.test(candidate)) return `telegram:${chatId}:${candidate}`;
  return candidate;
}

export function normalizeTradingEvent(input = {}, options = {}) {
  const legacyTelegram = input.source_chat_id !== undefined || input.raw_text !== undefined;
  const source = legacyTelegram
    ? {
        type: 'telegram_mtproto',
        instance_id: stringOrNull(input.source_instance_id || input.listener_node_id || input.source_chat_id),
        external_id: stringOrNull(input.source_chat_id),
      }
    : {
        type: stringOrNull(input.source?.type || input.source_type),
        instance_id: stringOrNull(input.source?.instance_id || input.source_instance_id),
        external_id: stringOrNull(input.source?.external_id || input.source_external_id),
      };

  const externalEventId = stringOrNull(input.external_event_id ?? input.source_message_id ?? input.event_id);
  const occurredAt = input.occurred_at || input.timestamp || new Date().toISOString();
  const chatId = telegramChatId(input, source, externalEventId);
  const replyCandidate = input.thread?.reply_to_event_id
    ?? input.thread?.reply_to_message_id
    ?? input.reply_to_event_id
    ?? input.reply_to_message_id;
  const editedCandidate = input.thread?.edited_event_id ?? input.edited_event_id;
  const isTelegram = String(source?.type || '').toLowerCase().startsWith('telegram') || String(externalEventId || '').startsWith('telegram:');

  const event = {
    version: String(input.version || '1.0'),
    workspace_hint: stringOrNull(input.workspace_hint || input.workspace_id),
    source,
    external_event_id: externalEventId,
    occurred_at: occurredAt,
    received_at: input.received_at || new Date().toISOString(),
    text: String(input.text ?? input.raw_text ?? ''),
    structured_payload: input.structured_payload && typeof input.structured_payload === 'object' ? input.structured_payload : {},
    thread: {
      thread_id: stringOrNull(input.thread?.thread_id || input.thread_id),
      reply_to_event_id: isTelegram
        ? canonicalTelegramEventId(replyCandidate, chatId)
        : stringOrNull(replyCandidate),
      edited_event_id: isTelegram
        ? canonicalTelegramEventId(editedCandidate, chatId)
        : stringOrNull(editedCandidate),
    },
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };

  const errors = [];
  if (!event.source.type) errors.push('source.type is required');
  if (options.requireIdentity && !event.source.instance_id) errors.push('source.instance_id is required');
  if (options.requireIdentity && !event.external_event_id) errors.push('external_event_id is required');
  if (!event.text && Object.keys(event.structured_payload).length === 0) errors.push('text or structured_payload is required');

  return { ok: errors.length === 0, event, errors };
}
