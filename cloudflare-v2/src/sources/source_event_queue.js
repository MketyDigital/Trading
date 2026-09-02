import { signSourcePayload } from '../security/source_auth.js';

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function sanitizeNativeEvent(event = {}) {
  const input = requireObject(event, 'source event');
  return {
    source_external_id: textOrNull(input.source_external_id),
    external_event_id: textOrNull(input.external_event_id),
    occurred_at: textOrNull(input.occurred_at),
    text: String(input.text ?? ''),
    structured_payload: input.structured_payload && typeof input.structured_payload === 'object'
      ? input.structured_payload
      : {},
    thread: input.thread && typeof input.thread === 'object' ? input.thread : {},
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}

function buildV1Body(source, event, nowMs) {
  const occurredAt = event.occurred_at || new Date(nowMs).toISOString();
  const sourceType = source.source_type ?? source.sourceType ?? source.source_family ?? source.sourceFamily;
  const sourceInstance = source.source_instance_id
    ?? source.sourceInstanceId
    ?? source.external_identity
    ?? source.externalIdentity
    ?? source.id;
  const sourceExternal = event.source_external_id
    ?? source.external_identity
    ?? source.externalIdentity
    ?? null;

  if (!sourceType || !sourceInstance || !event.external_event_id) {
    throw new TypeError('source event identity is incomplete');
  }

  return {
    version: '1.0',
    source: {
      type: String(sourceType),
      instance_id: String(sourceInstance),
      external_id: sourceExternal == null ? null : String(sourceExternal),
    },
    external_event_id: String(event.external_event_id),
    occurred_at: occurredAt,
    received_at: new Date(nowMs).toISOString(),
    text: event.text,
    structured_payload: event.structured_payload,
    thread: event.thread,
    metadata: event.metadata,
  };
}

export function createSourceEventQueue({
  queue,
  sourceStore,
  dispatch,
} = {}) {
  return {
    async enqueueSourceEvent(source, event) {
      if (!queue?.send) throw new TypeError('source event queue binding is required');
      if (!source?.id) throw new TypeError('source id is required');

      const payload = {
        version: 'mkety.source-event.v1',
        sourceId: String(source.id),
        event: sanitizeNativeEvent(event),
      };

      await queue.send(payload);
      return { queued: true };
    },

    async consumeSourceEvent(message, { nowMs = Date.now() } = {}) {
      if (!sourceStore?.getActiveSource) throw new TypeError('sourceStore is required');
      if (typeof dispatch !== 'function') throw new TypeError('dispatch is required');

      const envelope = requireObject(message, 'queue message');
      const sourceId = String(envelope.sourceId ?? '');
      if (!sourceId) throw new TypeError('queue source id is required');

      const source = await sourceStore.getActiveSource(sourceId);
      if (!source?.id || !source?.secret) {
        throw new Error('unknown or inactive source');
      }

      const event = sanitizeNativeEvent(envelope.event);
      const body = buildV1Body(source, event, Number(nowMs));
      const rawBody = JSON.stringify(body);
      const timestamp = String(Number(nowMs));
      const signature = await signSourcePayload(rawBody, timestamp, source.secret);

      const result = await dispatch({
        rawBody,
        sourceId: String(source.id),
        timestamp,
        signature,
      });

      if (!result?.ok) {
        const reason = result?.reason ? `: ${result.reason}` : '';
        throw new Error(`source event dispatch failed${reason}`);
      }
      return result;
    },
  };
}
