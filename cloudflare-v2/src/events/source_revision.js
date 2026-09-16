function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!plainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
  return output;
}

function isEditEvent(event = {}) {
  const kind = String(event?.metadata?.telegram_update_kind ?? event?.metadata?.telegramUpdateKind ?? '').toLowerCase();
  if (kind === 'edited_message' || kind === 'edited_channel_post') return true;
  return Boolean(event?.thread?.edited_event_id ?? event?.thread?.editedEventId ?? event?.edited_event_id);
}

function revisionMaterial(event = {}) {
  const native = plainObject(event?.metadata?.native_identity)
    ? event.metadata.native_identity
    : plainObject(event?.metadata?.nativeIdentity) ? event.metadata.nativeIdentity : {};
  return stableValue({
    sourceType: String(event?.source?.type ?? event?.source_type ?? ''),
    sourceExternalId: String(event?.source?.external_id ?? event?.source_external_id ?? ''),
    externalEventId: String(event?.external_event_id ?? event?.externalEventId ?? ''),
    nativeIdentity: {
      chatId: String(native.chat_id ?? native.chatId ?? ''),
      messageId: String(native.message_id ?? native.messageId ?? ''),
    },
    text: String(event?.text ?? event?.raw_text ?? ''),
    structuredPayload: plainObject(event?.structured_payload) ? event.structured_payload : {},
    replyToEventId: String(event?.thread?.reply_to_event_id ?? event?.thread?.replyToEventId ?? ''),
    replyToMessageId: String(event?.thread?.reply_to_message_id ?? event?.thread?.replyToMessageId ?? ''),
  });
}

export async function buildSourceRevisionKey(event = {}) {
  if (!isEditEvent(event)) return null;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle?.digest) throw new Error('SOURCE_REVISION_CRYPTO_UNAVAILABLE');
  const bytes = new TextEncoder().encode(JSON.stringify(revisionMaterial(event)));
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

export const sourceRevision = {
  isEditEvent,
  revisionMaterial,
};
