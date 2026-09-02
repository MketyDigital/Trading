import legacyWorker from './index.js';
import { buildCanonicalShadow } from './pipeline/canonical_shadow.js';
import { handleV1EventsRequest } from './http/v1_events.js';
import { handleV1AdminRequest } from './http/v1_admin.js';
import { handleInternalSourceEventRequest } from './http/internal_source_event.js';
import { validateStagingReadiness } from './config/staging_readiness.js';
import { createSourceQueueRuntime } from './sources/source_queue_runtime.js';

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

function retiredLegacyAdminResponse() {
  return new Response(JSON.stringify({
    ok: false,
    reason: 'LEGACY_ADMIN_API_RETIRED',
    replacement: '/api/v1/admin/*',
  }), {
    status: 410,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function notFoundResponse() {
  return new Response(JSON.stringify({ ok: false, reason: 'NOT_FOUND' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function healthResponse(request, env = {}) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, reason: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' },
    });
  }

  const core = validateStagingReadiness(env);
  const simulation = validateStagingReadiness(env, { requireSimulation: true });
  const status = !core.ready
    ? 'not_ready'
    : core.features.simulationEnabled && !simulation.ready ? 'degraded' : 'ready';

  return new Response(JSON.stringify({
    ok: true,
    service: 'mkety-trading-v1',
    status,
    ready: core.ready,
    simulationReady: simulation.ready,
    missing: core.missing,
    simulationMissing: simulation.missing,
    optionalMissing: core.optionalMissing,
    features: core.features,
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
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
  adminHandler = handleV1AdminRequest,
  internalSourceHandler = handleInternalSourceEventRequest,
  queueRuntime = null,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      // Versioned enterprise APIs live outside the legacy Telegram-oriented
      // Worker so new contracts can be secured and tenant-scoped independently.
      if (url.pathname === '/api/v1/health') {
        return healthResponse(request, env);
      }
      if (url.pathname === '/api/v1/events') {
        return eventsHandler(request, env, { ctx });
      }
      if (url.pathname === '/api/v1/internal/source-event') {
        return internalSourceHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/internal/')) {
        return notFoundResponse();
      }
      if (url.pathname.startsWith('/api/v1/admin/')) {
        return adminHandler(request, env, { ctx });
      }

      // The old admin implementation includes unscoped workspace listing and a
      // generic DB proxy. Cryptographic login alone cannot make that tenant-safe,
      // therefore every legacy admin API is retired instead of delegated.
      if (url.pathname.startsWith('/api/admin/')) {
        return retiredLegacyAdminResponse();
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

    async queue(batch, env, ctx) {
      const runtime = queueRuntime || createSourceQueueRuntime();
      return runtime(batch, env, { ctx });
    },

    async scheduled(event, env, ctx) {
      if (typeof legacy.scheduled === 'function') {
        return legacy.scheduled(event, env, ctx);
      }
    },
  };
}

export default createTradingV1Entrypoint();
