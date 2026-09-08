import legacyWorker from './index.js';
import { renderMketyAdminAccessCodesPage } from './dashboard_mkety_admin_access_codes.js';
import { renderEnterpriseTradingPortal } from './dashboard_enterprise_portal.js';
import { withEnterpriseConnectionEnhancements } from './dashboard_enterprise_enhancements.js';
import { handleV1EventsRequest } from './http/v1_events.js';
import { handleExternalMtprotoEndpointRequest } from './http/external_mtproto_endpoint.js';
import { handleV1AdminRequest } from './http/v1_admin.js';
import { handleV1AdminSourceIngressSecretRequest } from './http/v1_admin_source_ingress_secret.js';
import { handlePublicBrandingRequest } from './http/v1_branding.js';
import { handleInternalSourceEventRequest } from './http/internal_source_event.js';
import { handleTradingViewWebhookRequest } from './http/tradingview_webhook.js';
import { handleTradingAccessCodeRedeemRequest } from './http/v1_access_codes.js';
import { handleMketyAdminAccessCodesRequest } from './http/v1_mkety_admin_access_codes.js';
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

function htmlResponse(html) {
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function withPublicBrandingBootstrap(html) {
  const script = `<script>(function(){async function loadPublicBranding(){try{var r=await fetch('/api/v1/public/branding',{headers:{Accept:'application/json'}});if(!r.ok)return;var x=await r.json();if(!x||!x.ok||!x.branding)return;var b=x.branding||{};var title=(b.brandName||'Mkety')+' '+(b.productName||'Trading');var t=document.getElementById('brandTitle');if(t)t.textContent=title;document.title=title;if(b.accentColor)document.documentElement.style.setProperty('--accent',b.accentColor);var logo=document.getElementById('brandLogo');if(logo&&b.logoUrl){logo.src=b.logoUrl;logo.classList.remove('hidden')}var sub=document.getElementById('brandSubtitle');if(sub&&x.kind==='white_label')sub.textContent='Enterprise trading automation workspace.'}catch(_){}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadPublicBranding);else loadPublicBranding()})();</script>`;
  return String(html).replace('</body>', `${script}</body>`);
}

function normalizeEnterprisePortalHtml(html) {
  return String(html).replace('placeholder="gpt-5-mini"', 'placeholder="Enter the current provider model ID"');
}

async function publicSupabase(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

function retiredLegacyAdminResponse() {
  return new Response(JSON.stringify({ ok: false, reason: 'LEGACY_ADMIN_API_RETIRED', replacement: '/api/v1/admin/*' }), { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function retiredLegacySignalResponse() {
  return new Response(JSON.stringify({ ok: false, reason: 'LEGACY_SIGNAL_WEBHOOK_RETIRED', replacement: '/api/v1/internal/source-event or /api/v1/events' }), { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function notFoundResponse() {
  return new Response(JSON.stringify({ ok: false, reason: 'NOT_FOUND' }), { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function isTradingViewCertificateProbeRequest(url, env = {}) {
  return url.pathname === '/api/v1/webhooks/tradingview/probe' && enabled(env?.TRADINGVIEW_CERT_PROBE_ENABLED);
}

function healthResponse(request, env = {}) {
  if (request.method !== 'GET') return new Response(JSON.stringify({ ok: false, reason: 'METHOD_NOT_ALLOWED' }), { status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' } });
  const core = validateStagingReadiness(env);
  const simulation = validateStagingReadiness(env, { requireSimulation: true });
  const mtprotoContainer = validateStagingReadiness(env, { requireMtprotoContainer: true });
  const status = !core.ready ? 'not_ready' : core.features.simulationEnabled && !simulation.ready ? 'degraded' : 'ready';
  return new Response(JSON.stringify({ ok: true, service: 'mkety-trading-v1', status, ready: core.ready, simulationReady: simulation.ready, mtprotoContainerReady: mtprotoContainer.ready, missing: core.missing, simulationMissing: simulation.missing, mtprotoContainerMissing: mtprotoContainer.missing, optionalMissing: core.optionalMissing, features: core.features }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export function createTradingV1Entrypoint({
  legacy = legacyWorker,
  eventsHandler = handleV1EventsRequest,
  externalMtprotoHandler = handleExternalMtprotoEndpointRequest,
  adminHandler = handleV1AdminRequest,
  sourceIngressSecretHandler = handleV1AdminSourceIngressSecretRequest,
  internalSourceHandler = handleInternalSourceEventRequest,
  tradingViewHandler = handleTradingViewWebhookRequest,
  accessCodeRedeemHandler = handleTradingAccessCodeRedeemRequest,
  mketyAdminAccessCodesHandler = handleMketyAdminAccessCodesRequest,
  publicBrandingHandler = handlePublicBrandingRequest,
  queueRuntime = null,
  recoveryRuntime = null,
  destinationRetryRuntime = null,
  bindingRepairRuntime = null,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === '/' || url.pathname === '') {
        const portal = normalizeEnterprisePortalHtml(withEnterpriseConnectionEnhancements(normalizeEnterprisePortalHtml(renderEnterpriseTradingPortal(env))));
        return htmlResponse(withPublicBrandingBootstrap(portal));
      }
      if (url.pathname === '/workspace-console' || url.pathname === '/workspace-console/' || url.pathname === '/launch-console' || url.pathname === '/launch-console/') return new Response(null, { status: 302, headers: { Location: '/' } });
      if (url.pathname === '/mkety-admin/access-codes' || url.pathname === '/mkety-admin/access-codes/') return htmlResponse(renderMketyAdminAccessCodesPage());
      if (url.pathname === '/api/v1/health') return healthResponse(request, env);
      if (url.pathname === '/api/v1/public/branding') {
        const supabase = await publicSupabase(env);
        return publicBrandingHandler(request, env, { supabase });
      }
      if (url.pathname === '/api/v1/internal/source-event') return internalSourceHandler(request, env, { ctx });
      if (url.pathname.startsWith('/api/v1/internal/')) return notFoundResponse();
      if (url.pathname === '/api/v1/access/redeem') return accessCodeRedeemHandler(request, env, { ctx });
      if (url.pathname.startsWith('/api/v1/access/')) return notFoundResponse();
      if (url.pathname === '/api/v1/mkety-admin/access-codes' || url.pathname.startsWith('/api/v1/mkety-admin/access-codes/')) return mketyAdminAccessCodesHandler(request, env, { ctx });
      if (url.pathname.startsWith('/api/v1/mkety-admin/')) return notFoundResponse();
      if (/^\/api\/v1\/external\/mtproto\/[^/]+\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return externalMtprotoHandler(request, env, { ctx, eventsHandler });
      }
      if (url.pathname.startsWith('/api/v1/external/')) return notFoundResponse();
      if (url.pathname === '/api/v1/events') {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return eventsHandler(request, env, { ctx });
      }
      if (/^\/api\/v1\/admin\/sources\/[^/]+\/ingress-secret$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return sourceIngressSecretHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/admin/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return adminHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/webhooks/tradingview/')) {
        if (!isTradingAccessEnabled(env) && !isTradingViewCertificateProbeRequest(url, env)) return tradingAccessDisabledResponse();
        return tradingViewHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/webhooks/')) return notFoundResponse();
      if (url.pathname === '/api/webhook/process_signal') return retiredLegacySignalResponse();
      if (url.pathname.startsWith('/api/admin/')) return retiredLegacyAdminResponse();
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
        const [mtprotoResult, retryResult, bindingRepairResult] = await Promise.allSettled([mtprotoRuntime(env, { ctx }), retryRuntime(env, { ctx }), repairRuntime(env, { ctx })]);
        return { mtprotoRecovery: mtprotoResult.status, destinationRetryRecovery: retryResult.status, bindingRepairRecovery: bindingRepairResult.status };
      }
      if (typeof legacy.scheduled === 'function') return legacy.scheduled(event, env, ctx);
    },
  };
}

export default createTradingV1Entrypoint();