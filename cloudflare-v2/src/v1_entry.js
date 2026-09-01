import legacyWorker from './index.js';
import { buildCanonicalShadow } from './pipeline/canonical_shadow.js';
import { handleV1EventsRequest } from './http/v1_events.js';

export { MTProtoListenerNode } from './listener/listener_node.js';
export { TradeStateNode } from './state/trade_state_node.js';

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function canonicalEventFromLegacyPayload(payload = {}) {
  const sourceChatId = payload.source_chat_id != null ? String(payload.source_chat_id) : null;
  return {
    version: '1.0',
    workspace_hint: payload.workspace_id != null ? String(payload.workspace_id) : null,
    source: {
      type: 'telegram_mtproto',
      instance_id: String(payload.source_instance_id ?? payload.listener_node_id ?? sourceChatId ?? 'legacy-telegram'),
      external_id: sourceChatId,
    },
    external_event_id: String(payload.source_message_id ?? payload.event_id ?? '1'),
    occurred_at: payload.occurred_at || payload.timestamp || new Date().toISOString(),
    received_at: new Date().toISOString(),
    text: String(payload.raw_text ?? payload.text ?? ''),
    structured_payload: payload.structured_payload && typeof payload.structured_payload === 'object'
      ? payload.structured_payload
      : {},
    thread: {
      thread_id: payload.thread_id != null ? String(payload.thread_id) : null,
      reply_to_event_id: payload.reply_to_message_id != null
        ? String(payload.reply_to_message_id)
        : payload.reply_to_event_id != null ? String(payload.reply_to_event_id) : null,
      edited_event_id: payload.edited_event_id != null ? String(payload.edited_event_id) : null,
    },
    metadata: { shadow_from_legacy_webhook: true },
  };
}

function shadowError(error) {
  return {
    status: 'ERROR',
    executionEnabled: false,
    actions: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

async function attachShadowDiagnostics(response, shadowPromise) {
  const shadow = await shadowPromise;
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return response;

  try {
    const body = await response.clone().json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return response;
    body.trace = body.trace && typeof body.trace === 'object' ? body.trace : {};
    body.trace.v1_shadow = shadow;

    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

export function createTradingV1Entrypoint({
  legacy = legacyWorker,
  shadowBuilder = buildCanonicalShadow,
  eventsHandler = handleV1EventsRequest,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      // New universal ingestion contract is intentionally outside the legacy
      // Telegram-specific Worker. Sources such as DO/MTProto, Telethon VMs,
      // TradingView relays, MT5 bridges and custom systems use the same route.
      if (url.pathname === '/api/v1/events') {
        return eventsHandler(request, env, { ctx });
      }

      const shadowEnabled = isEnabled(env?.TRADING_V1_SHADOW);
      const isLegacySignalWebhook = request.method === 'POST' && url.pathname === '/api/webhook/process_signal';

      if (!shadowEnabled || !isLegacySignalWebhook) {
        return legacy.fetch(request, env, ctx);
      }

      // Clone before legacy consumes the body. Shadow analysis has no broker or
      // destination side effects and can never authorize execution.
      const shadowRequest = request.clone();
      const shadowPromise = (async () => {
        const payload = await shadowRequest.json();
        const event = canonicalEventFromLegacyPayload(payload);
        return shadowBuilder(event, {
          // Deterministic-only by default so enabling shadow cannot double AI
          // traffic or delay paid signal delivery. Tenant AI is used on the
          // authenticated /api/v1/events path after workspace resolution.
          aiRouter: null,
          aiTimeoutMs: Number(env?.TRADING_V1_SHADOW_AI_TIMEOUT_MS || 600),
        });
      })().catch(shadowError);

      const legacyResponse = await legacy.fetch(request, env, ctx);
      return attachShadowDiagnostics(legacyResponse, shadowPromise);
    },

    async scheduled(event, env, ctx) {
      if (typeof legacy.scheduled === 'function') {
        return legacy.scheduled(event, env, ctx);
      }
    },
  };
}

export default createTradingV1Entrypoint();
