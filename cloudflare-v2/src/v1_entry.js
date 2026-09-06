import legacyWorker from './index.js';
import { handleV1EventsRequest } from './http/v1_events.js';
import { handleV1AdminRequest } from './http/v1_admin.js';
import { handleInternalSourceEventRequest } from './http/internal_source_event.js';
import { handleTradingViewWebhookRequest } from './http/tradingview_webhook.js';
import { validateStagingReadiness } from './config/staging_readiness.js';
import { createSourceQueueRuntime } from './sources/source_queue_runtime.js';
import { createMtprotoRecoveryRuntime } from './sources/mtproto/recovery_runtime.js';
import { createProductionDestinationRetryRuntime } from './execution/destination_retry_production.js';
import { runScheduledBindingRepairs } from './execution/production_binding_repair.js';
import { isTradingAccessEnabled, tradingAccessDisabledResponse } from './security/trading_runtime_access.js';

export { MTProtoListenerNode } from './listener/listener_node.js';
export { TradeStateNode } from './state/trade_state_node.js';
export { MtprotoContainerRuntime } from './sources/mtproto/container_runtime.js';

const MTPROTO_RECOVERY_CRON = '* * * * *';

function retiredLegacyAdminResponse() {
  return new Response(JSON.stringify({
    ok: false,
    reason: 'LEGACY_ADMIN_API_RETIRED',
    replacement: '/api/v1/admin/*',
  }), {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function retiredLegacySignalResponse() {
  return new Response(JSON.stringify({
    ok: false,
    reason: 'LEGACY_SIGNAL_WEBHOOK_RETIRED',
    replacement: '/api/v1/internal/source-event or /api/v1/events',
  }), {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
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

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function isTradingViewCertificateProbeRequest(url, env = {}) {
  return url.pathname === '/api/v1/webhooks/tradingview/probe'
    && enabled(env?.TRADINGVIEW_CERT_PROBE_ENABLED);
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
  const mtprotoContainer = validateStagingReadiness(env, { requireMtprotoContainer: true });
  const status = !core.ready
    ? 'not_ready'
    : core.features.simulationEnabled && !simulation.ready ? 'degraded' : 'ready';

  return new Response(JSON.stringify({
    ok: true,
    service: 'mkety-trading-v1',
    status,
    ready: core.ready,
    simulationReady: simulation.ready,
    mtprotoContainerReady: mtprotoContainer.ready,
    missing: core.missing,
    simulationMissing: simulation.missing,
    mtprotoContainerMissing: mtprotoContainer.missing,
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

export function createTradingV1Entrypoint({
  legacy = legacyWorker,
  eventsHandler = handleV1EventsRequest,
  adminHandler = handleV1AdminRequest,
  internalSourceHandler = handleInternalSourceEventRequest,
  tradingViewHandler = handleTradingViewWebhookRequest,
  queueRuntime = null,
  recoveryRuntime = null,
  destinationRetryRuntime = null,
  bindingRepairRuntime = null,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      // Health and exact internal service routes stay available independently
      // so operators and first-party source handoff can function while tenant
      // Trading access is globally disabled.
      if (url.pathname === '/api/v1/health') {
        return healthResponse(request, env);
      }
      if (url.pathname === '/api/v1/internal/source-event') {
        return internalSourceHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/internal/')) {
        return notFoundResponse();
      }

      // Externally reachable V1 Trading application APIs require an explicit
      // Worker-wide access opt-in. Missing configuration fails closed.
      if (url.pathname === '/api/v1/events') {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return eventsHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/admin/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return adminHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/webhooks/tradingview/')) {
        if (!isTradingAccessEnabled(env) && !isTradingViewCertificateProbeRequest(url, env)) {
          return tradingAccessDisabledResponse();
        }
        return tradingViewHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/webhooks/')) {
        return notFoundResponse();
      }

      // The unauthenticated legacy signal processor included broker-capable
      // execution and is no longer a supported first-party transport. Current
      // MTProto providers use SOURCE_EVENT_QUEUE or the authenticated internal
      // source-event handoff, so this public route must never reach legacy code.
      if (url.pathname === '/api/webhook/process_signal') {
        return retiredLegacySignalResponse();
      }

      // The old admin implementation includes unscoped workspace listing and a
      // generic DB proxy. Cryptographic login alone cannot make that tenant-safe,
      // therefore every legacy admin API is retired instead of delegated.
      if (url.pathname.startsWith('/api/admin/')) {
        return retiredLegacyAdminResponse();
      }

      return legacy.fetch(request, env, ctx);
    },

    async queue(batch, env, ctx) {
      const runtime = queueRuntime || createSourceQueueRuntime();
      return runtime(batch, env, { ctx });
    },

    async scheduled(event, env, ctx) {
      if (event?.cron === MTPROTO_RECOVERY_CRON) {
        const mtprotoRuntime = recoveryRuntime || createMtprotoRecoveryRuntime();
        const retryRuntime = destinationRetryRuntime || createProductionDestinationRetryRuntime();
        const repairRuntime = bindingRepairRuntime || runScheduledBindingRepairs;
        const [mtprotoResult, retryResult, bindingRepairResult] = await Promise.allSettled([
          mtprotoRuntime(env, { ctx }),
          retryRuntime(env, { ctx }),
          repairRuntime(env, { ctx }),
        ]);
        return {
          mtprotoRecovery: mtprotoResult.status,
          destinationRetryRecovery: retryResult.status,
          bindingRepairRecovery: bindingRepairResult.status,
        };
      }
      if (typeof legacy.scheduled === 'function') {
        return legacy.scheduled(event, env, ctx);
      }
    },
  };
}

export default createTradingV1Entrypoint();