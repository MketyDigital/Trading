import { createSignedV1SourceClient } from './signed_v1_client.js';
import { createNonTelegramSourceRuntime } from './source_runtime.js';

function normalizeEvent(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('CUSTOM_SOURCE_EVENT_INVALID');
  }

  return {
    providerType: 'custom_signed_api',
    nativeEventId: input.eventId,
    occurredAt: input.occurredAt,
    text: input.text,
    structuredPayload: input.structuredPayload,
    metadata: input.metadata,
  };
}

export function createCustomSignedApiProducer({
  endpoint,
  sourceId,
  sourceSecret,
  transport,
  retryDelaysMs = [],
  sleep,
  nowMs,
} = {}) {
  const clientOptions = { endpoint, sourceId, sourceSecret };
  if (transport !== undefined) clientOptions.transport = transport;
  if (nowMs !== undefined) clientOptions.nowMs = nowMs;
  const client = createSignedV1SourceClient(clientOptions);

  const runtimeOptions = {
    providerType: 'custom_signed_api',
    client,
    retryDelaysMs,
  };
  if (sleep !== undefined) runtimeOptions.sleep = sleep;
  if (nowMs !== undefined) runtimeOptions.nowMs = nowMs;
  const runtime = createNonTelegramSourceRuntime(runtimeOptions);

  return Object.freeze({
    publish(input) {
      return runtime.deliver(normalizeEvent(input));
    },
    status() {
      return runtime.status();
    },
  });
}
