const SUPPORTED = new Set([
  'mt5_source_bridge',
  'ctrader_source',
  'custom_signed_api',
]);

const BLOCKED_METADATA_KEY = /(?:secret|token|password|credential|workspace|destination|broker|execution|source_connection|account_id)/i;

function requiredString(value, code) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isPlainObject(value)) return null;

  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (BLOCKED_METADATA_KEY.test(key)) continue;
    output[key] = sanitizeValue(value[key]);
  }
  return output;
}

function sanitizeMetadata(value) {
  if (!isPlainObject(value)) return {};
  return sanitizeValue(value);
}

function cloneStructuredPayload(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value) && !Array.isArray(value)) {
    throw new Error('SOURCE_STRUCTURED_PAYLOAD_INVALID');
  }
  return structuredClone(value);
}

export function buildSignedSourceEventPayload(input = {}) {
  const providerType = requiredString(input.providerType, 'SOURCE_ADAPTER_PROVIDER_REQUIRED');
  if (!SUPPORTED.has(providerType)) throw new Error('SOURCE_ADAPTER_PROVIDER_UNSUPPORTED');

  const nativeEventId = requiredString(input.nativeEventId, 'SOURCE_NATIVE_EVENT_ID_REQUIRED');
  const occurredAt = requiredString(input.occurredAt, 'SOURCE_OCCURRED_AT_REQUIRED');
  const text = String(input.text ?? '').trim();
  const structuredPayload = cloneStructuredPayload(input.structuredPayload);

  if (!text && structuredPayload === null) {
    throw new Error('SOURCE_EVENT_CONTENT_REQUIRED');
  }

  const nativeIdentity = providerType === 'mt5_source_bridge'
    ? { transaction_id: nativeEventId }
    : { event_id: nativeEventId };

  const metadata = {
    ...sanitizeMetadata(input.metadata),
    native_identity: nativeIdentity,
  };

  const payload = {
    external_event_id: nativeEventId,
    occurred_at: occurredAt,
    metadata,
  };

  if (text) payload.text = text;
  if (structuredPayload !== null) payload.structured_payload = structuredPayload;

  return payload;
}
