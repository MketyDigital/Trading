import { verifySignedSourcePayload } from '../security/source_auth.js';
import { normalizeTradingEvent } from '../events/trading_event.js';
import { interpretTradingEvent } from '../ai/trading_interpreter.js';
import { buildCanonicalSourceEventId } from '../sources/canonical_event_id.js';
import { authorizeExternalMtprotoEvent } from '../sources/mtproto/external_policy.js';

function deriveCanonicalEventId(source, input) {
  if (!source?.source_family || !source?.external_identity) return null;
  const nativeIdentity = input?.metadata?.native_identity;
  if (!nativeIdentity || typeof nativeIdentity !== 'object') return null;

  try {
    return buildCanonicalSourceEventId({
      sourceFamily: source.source_family,
      accountScope: source.external_identity,
      nativeIdentity,
    });
  } catch {
    // Backward compatibility: older/custom providers without a complete native
    // identity continue to use the existing source-scoped external_event_id.
    return null;
  }
}

export async function ingestTradingEvent({
  rawBody,
  sourceId,
  timestamp,
  signature,
  nowMs = Date.now(),
} = {}, {
  sourceStore,
  eventStore,
  aiRouter,
  aiRouterFactory,
  interpretationTimeoutMs = 1200,
} = {}) {
  if (!sourceStore?.getActiveSource || !eventStore?.reserve) {
    throw new TypeError('sourceStore and eventStore are required');
  }

  const source = await sourceStore.getActiveSource(String(sourceId ?? ''));
  if (!source?.id || !source?.secret) {
    return { ok: false, status: 401, reason: 'UNKNOWN_OR_INACTIVE_SOURCE' };
  }

  const auth = await verifySignedSourcePayload({
    rawBody,
    sourceId,
    timestamp,
    signature,
    secret: source.secret,
    nowMs,
  });
  if (!auth.ok) return { ok: false, status: 401, reason: auth.reason };

  let input;
  try {
    input = JSON.parse(String(rawBody ?? ''));
  } catch {
    return { ok: false, status: 400, reason: 'INVALID_JSON' };
  }

  // External MTProto authorization is server-owned and runs only after source
  // HMAC authentication, but before normalization, reservation, AI or trading
  // work. Local VM filtering is an optimization and never an authority.
  const sourcePolicy = authorizeExternalMtprotoEvent({ source, input });
  if (!sourcePolicy.ok) return sourcePolicy;

  // Source identity and workspace authority come from the authenticated source
  // registry, never from client-controlled payload fields.
  const normalizedInput = {
    ...input,
    workspace_hint: source.workspace_id,
    source: {
      type: source.source_type,
      instance_id: source.source_instance_id,
      external_id: input?.source?.external_id ?? input?.source_external_id ?? null,
    },
  };
  const normalized = normalizeTradingEvent(normalizedInput, { requireIdentity: true });
  if (!normalized.ok) {
    return { ok: false, status: 400, reason: 'INVALID_TRADING_EVENT', errors: normalized.errors };
  }

  const event = normalized.event;
  const canonicalEventId = deriveCanonicalEventId(source, input);
  const reservationRow = {
    workspace_id: source.workspace_id,
    source_connection_id: source.id,
    external_event_id: event.external_event_id,
    event_version: event.version,
    source_type: event.source.type,
    source_external_id: event.source.external_id,
    occurred_at: event.occurred_at,
    raw_text: event.text,
    structured_payload: event.structured_payload,
    thread: event.thread,
    metadata: event.metadata,
  };
  if (canonicalEventId) reservationRow.canonical_event_id = canonicalEventId;

  const reservation = await eventStore.reserve(reservationRow);

  if (reservation?.duplicate) {
    return {
      ok: true,
      duplicate: true,
      eventId: reservation.eventId ?? null,
      event,
    };
  }
  if (!reservation?.ok) {
    return { ok: false, status: 503, reason: 'EVENT_RESERVATION_FAILED' };
  }

  // Tenant AI configuration is loaded only after HMAC authentication and
  // trusted workspace resolution. A client payload cannot select another
  // workspace's provider credentials.
  const resolvedAiRouter = aiRouterFactory
    ? await aiRouterFactory({ source, event })
    : aiRouter;

  const interpretation = await interpretTradingEvent(event, {
    aiRouter: resolvedAiRouter,
    timeoutMs: interpretationTimeoutMs,
  });

  if (eventStore.updateInterpretation) {
    await eventStore.updateInterpretation(reservation.eventId, interpretation);
  }

  return {
    ok: true,
    duplicate: false,
    eventId: reservation.eventId,
    event,
    interpretation,
  };
}
