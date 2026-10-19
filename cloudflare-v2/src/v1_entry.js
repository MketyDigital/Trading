import { renderMketyAdminAccessCodesPage } from './dashboard_mkety_admin_access_codes.js';
import { renderMketyAdminOperationsPage } from './dashboard_mkety_admin_operations.js';
import { VIPMembershipManager } from './vip/vip_manager.js';
import { renderEnterpriseTradingPortal } from './dashboard_enterprise_portal.js';
import { withEnterpriseConnectionEnhancements } from './dashboard_enterprise_enhancements.js';
import { withRoutingAiCompletion } from './dashboard_routing_ai_completion.js';
import { withUserAcceptanceControls } from './dashboard_user_acceptance_controls.js';
import { withReturningOwnerSession } from './dashboard_returning_session.js';
import { handleV1EventsRequest } from './http/v1_events.js';
import { handleExternalMtprotoEndpointRequest } from './http/external_mtproto_endpoint.js';
import { handleV1AdminRequest } from './http/v1_admin.js';
import { handleV1AdminSourceIngressSecretRequest } from './http/v1_admin_source_ingress_secret.js';
import { handlePublicBrandingRequest } from './http/v1_branding.js';
import { handleInternalSourceEventRequest } from './http/internal_source_event.js';
import { handleTradingViewWebhookRequest } from './http/tradingview_webhook.js';
import { handleTradingAccessCodeRedeemRequest } from './http/v1_access_codes.js';
import { handleMketyAdminAccessCodesRequest } from './http/v1_mkety_admin_access_codes.js';
import { createMketyAdminOperationsStore, handleMketyAdminOperationsRequest } from './http/v1_mkety_admin_operations.js';
import { handleMketyAdminTradeRepairRequest } from './http/v1_mkety_admin_trade_repair.js';
import { validateStagingReadiness } from './config/staging_readiness.js';
import { createSourceQueueRuntime } from './sources/source_queue_runtime.js';
import { createMtprotoRecoveryRuntime } from './sources/mtproto/recovery_runtime.js';
import { createProductionDestinationRetryRuntime } from './execution/destination_retry_production.js';
import { runScheduledBindingRepairs } from './execution/production_binding_repair.js';
import { createProductionPendingOrderLifecycleRuntime } from './execution/pending_order_lifecycle_production.js';
import { createProductionBrokerTpProtectionRuntime } from './execution/broker_tp_protection_production.js';
import { createOrphanSignalRecoveryRuntime } from './sources/orphan_signal_recovery_runtime.js';
import { handleCustomHostnameRouteProofRequest } from './security/custom_hostname_route_proof.js';
import { isTradingAccessEnabled, tradingAccessDisabledResponse } from './security/trading_runtime_access.js';
import { createTradingReplicationRuntime } from './persistence/trading_replication_runtime.js';

export { MTProtoListenerNode } from './listener/listener_node.js';
export { TradeStateNode } from './state/trade_state_node.js';
export { MtprotoContainerRuntime } from './sources/mtproto/container_runtime.js';

const MTPROTO_RECOVERY_CRON = '* * * * *';
const LEGACY_VIP_LIFECYCLE_CRON = '*/15 * * * *';
const pendingOrderLifecycleRuntime = createProductionPendingOrderLifecycleRuntime();
const brokerTpProtectionRuntime = createProductionBrokerTpProtectionRuntime();
const orphanSignalRecoveryRuntime = createOrphanSignalRecoveryRuntime();
const PUBLIC_BRANDING_CACHE_TTL_MS = 30_000;
const PUBLIC_BRANDING_CACHE_MAX_HOSTS = 256;
const publicBrandingCache = new Map();
const publicBrandingInFlight = new Map();

function scheduledMaintenanceDue(event, env = {}) {
  // Tests and manual invocations may omit scheduledTime; preserve the old
  // behavior for those calls. Cloudflare cron events always provide it.
  if (event?.scheduledTime == null) return true;
  const interval = Math.max(1, Math.min(60, Math.trunc(Number(env.TRADING_MAINTENANCE_INTERVAL_MINUTES) || 5)));
  const timestamp = Number(event.scheduledTime);
  if (!Number.isFinite(timestamp)) return true;
  return Math.floor(timestamp / 60_000) % interval === 0;
}

function htmlResponse(html) {
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeAccent(value) {
  const color = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function safeHttpsUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch { return null; }
}

function applyInitialBranding(html, payload = null) {
  if (!payload?.ok || !payload?.branding) return String(html);
  const branding = payload.branding || {};
  const brandName = String(branding.brandName || 'Mkety').trim() || 'Mkety';
  const productName = String(branding.productName || 'Trading').trim() || 'Trading';
  const title = `${brandName} ${productName}`.trim();
  const accent = safeAccent(branding.accentColor);
  const logoUrl = safeHttpsUrl(branding.logoUrl);

  let output = String(html)
    .replace('<title>Mkety Trading</title>', `<title>${escapeHtml(title)}</title>`)
    .replace('<h1 id="brandTitle">Mkety Trading</h1>', `<h1 id="brandTitle">${escapeHtml(title)}</h1>`);

  if (accent) output = output.replace('--accent:#0f172a', `--accent:${accent}`);
  if (logoUrl) {
    output = output.replace(
      '<img id="brandLogo" class="logo hidden" alt="Brand logo">',
      `<img id="brandLogo" class="logo" src="${escapeHtml(logoUrl)}" alt="Brand logo">`,
    );
  }
  if (payload.kind === 'white_label') {
    output = output.replace(
      '<div id="brandSubtitle" class="muted">Enterprise signal automation, routing and execution workspace.</div>',
      '<div id="brandSubtitle" class="muted">Enterprise trading automation workspace.</div>',
    );
  }
  return output;
}

function withPublicBrandingBootstrap(html) {
  const script = `<script>(function(){async function loadPublicBranding(){try{var r=await fetch('/api/v1/public/branding',{headers:{Accept:'application/json'}});if(!r.ok)return;var x=await r.json();if(!x||!x.ok||!x.branding)return;var b=x.branding||{};var title=(b.brandName||'Mkety')+' '+(b.productName||'Trading');var t=document.getElementById('brandTitle');if(t)t.textContent=title;document.title=title;if(b.accentColor)document.documentElement.style.setProperty('--accent',b.accentColor);var logo=document.getElementById('brandLogo');if(logo&&b.logoUrl){logo.src=b.logoUrl;logo.classList.remove('hidden')}var sub=document.getElementById('brandSubtitle');if(sub&&x.kind==='white_label')sub.textContent='Enterprise trading automation workspace.'}catch(_){}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadPublicBranding);else loadPublicBranding()})();</script>`;
  return String(html).replace('</body>', `${script}</body>`);
}

function normalizeEnterprisePortalHtml(html) {
  return String(html).replace('placeholder="gpt-5-mini"', 'placeholder="Enter the current provider model ID"');
}

function cachedPublicBranding(hostname) {
  const now = Date.now();
  const cached = publicBrandingCache.get(hostname);
  if (cached?.expiresAt > now) return cached.payload;
  if (cached) publicBrandingCache.delete(hostname);
  return null;
}

async function resolveInitialBranding(request, env, publicBrandingHandler, persistenceRuntime = null) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  const cached = cachedPublicBranding(hostname);
  if (cached) return cached;
  const pending = publicBrandingInFlight.get(hostname);
  if (pending) return pending;

  const loading = (async () => {
    try {
      const response = await publicBrandingHandler(request, env, persistenceRuntime ? { persistenceRuntime } : {});
      if (!response?.ok) return null;
      const payload = await response.json();
      if (!payload?.ok || !payload?.branding) return null;
      if (publicBrandingCache.size >= PUBLIC_BRANDING_CACHE_MAX_HOSTS) {
        const oldest = publicBrandingCache.keys().next().value;
        if (oldest) publicBrandingCache.delete(oldest);
      }
      publicBrandingCache.set(hostname, { payload, expiresAt: Date.now() + PUBLIC_BRANDING_CACHE_TTL_MS });
      return payload;
    } catch { return null; }
  })();
  publicBrandingInFlight.set(hostname, loading);
  try { return await loading; }
  finally { if (publicBrandingInFlight.get(hostname) === loading) publicBrandingInFlight.delete(hostname); }
}

async function initialPortalResponse(request, env, ctx, {
  portal,
  usePersistenceRuntime,
  persistenceRuntimeFactory,
  publicBrandingHandler,
}) {
  let branding = cachedPublicBranding(new URL(request.url).hostname.toLowerCase());
  let runtime = null;
  if (!branding && usePersistenceRuntime) {
    try {
      runtime = ctx?.tradingPersistenceRuntime || await persistenceRuntimeFactory(env);
      branding = await resolveInitialBranding(request, env, publicBrandingHandler, runtime);
    } catch {
      // The public portal should still load if storage is temporarily unavailable.
    } finally {
      if (!ctx?.tradingPersistenceRuntime) {
        try { await runtime?.close?.(); } catch { /* Preserve the portal response. */ }
      }
    }
  } else if (!branding) {
    branding = await resolveInitialBranding(request, env, publicBrandingHandler);
  }
  const initial = withReturningOwnerSession(applyInitialBranding(portal, branding));
  return htmlResponse(branding ? initial : withPublicBrandingBootstrap(initial));
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

function storageRuntimeUnavailable(reason = 'TRADING_STORAGE_RUNTIME_UNAVAILABLE') {
  return new Response(JSON.stringify({ ok: false, reason }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function withTradingPersistenceRuntime(factory, env, handler, ctx = null) {
  const existing = ctx?.tradingPersistenceRuntime;
  if (existing) return handler(existing);
  let runtime;
  try {
    runtime = await factory(env);
    return await handler(runtime);
  } catch {
    return storageRuntimeUnavailable();
  } finally {
    try { await runtime?.close?.(); } catch { /* Preserve the handler response. */ }
  }
}

function migratedStorageRuntimePath(pathname) {
  return pathname === '/api/v1/health'
    || pathname === '/api/v1/events'
    || pathname === '/api/v1/internal/source-event'
    || pathname === '/api/v1/custom-hostname/probe'
    || pathname === '/api/v1/public/branding'
    || pathname.startsWith('/api/v1/webhooks/tradingview/')
    || /^\/api\/v1\/external\/mtproto\/[^/]+\/[^/]+$/.test(pathname)
    || pathname === '/api/v1/access/redeem' || pathname === '/api/v1/access/session' || pathname === '/api/v1/access/logout'
    || pathname === '/api/v1/mkety-admin/operations'
    || /^\/api\/v1\/mkety-admin\/trade-repair\/[^/]+$/.test(pathname)
    || pathname === '/api/v1/mkety-admin/runtime-controls'
    || pathname === '/api/v1/mkety-admin/access-codes'
    || pathname.startsWith('/api/v1/mkety-admin/access-codes/')
    || pathname.startsWith('/api/v1/mkety-admin/test-workspaces/')
    || /^\/api\/v1\/admin\/sources\/[^/]+\/ingress-secret$/.test(pathname)
    || pathname.startsWith('/api/v1/admin/');
}

export function createTradingV1Entrypoint({
  legacy = null,
  eventsHandler = handleV1EventsRequest,
  externalMtprotoHandler = handleExternalMtprotoEndpointRequest,
  adminHandler = handleV1AdminRequest,
  sourceIngressSecretHandler = handleV1AdminSourceIngressSecretRequest,
  internalSourceHandler = handleInternalSourceEventRequest,
  tradingViewHandler = handleTradingViewWebhookRequest,
  accessCodeRedeemHandler = handleTradingAccessCodeRedeemRequest,
  mketyAdminAccessCodesHandler = handleMketyAdminAccessCodesRequest,
  mketyAdminOperationsHandler = handleMketyAdminOperationsRequest,
  mketyAdminTradeRepairHandler = handleMketyAdminTradeRepairRequest,
  publicBrandingHandler = handlePublicBrandingRequest,
  customHostnameRouteProofHandler = handleCustomHostnameRouteProofRequest,
  queueRuntime = null,
  recoveryRuntime = null,
  destinationRetryRuntime = null,
  bindingRepairRuntime = null,
  orphanSignalRecoveryRuntime: configuredOrphanSignalRecoveryRuntime = null,
  brokerTpProtectionRuntime: configuredBrokerTpProtectionRuntime = null,
  persistenceRuntimeFactory = null,
  persistenceRuntimeEnabled = () => true,
  replicationRuntimeFactory = createTradingReplicationRuntime,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const usePersistenceRuntime = Boolean(persistenceRuntimeFactory && persistenceRuntimeEnabled(env));
      if (usePersistenceRuntime && url.pathname.startsWith('/api/v1/') && !migratedStorageRuntimePath(url.pathname)) {
        return storageRuntimeUnavailable('STORAGE_PATH_NOT_MIGRATED');
      }
      if (url.pathname === '/' || url.pathname === '') {
        const branding = usePersistenceRuntime ? null : await resolveInitialBranding(request, env, publicBrandingHandler);
        const portal = normalizeEnterprisePortalHtml(withUserAcceptanceControls(withRoutingAiCompletion(withEnterpriseConnectionEnhancements(normalizeEnterprisePortalHtml(renderEnterpriseTradingPortal(env))))));
        if (usePersistenceRuntime) {
          return initialPortalResponse(request, env, ctx, {
            portal,
            usePersistenceRuntime,
            persistenceRuntimeFactory,
            publicBrandingHandler,
          });
        }
        const initial = withReturningOwnerSession(applyInitialBranding(portal, branding));
        return htmlResponse(branding ? initial : withPublicBrandingBootstrap(initial));
      }
      if (url.pathname === '/workspace-console' || url.pathname === '/workspace-console/' || url.pathname === '/launch-console' || url.pathname === '/launch-console/') return new Response(null, { status: 302, headers: { Location: '/' } });
      if (url.pathname === '/mkety-admin/access-codes' || url.pathname === '/mkety-admin/access-codes/') return htmlResponse(renderMketyAdminAccessCodesPage());
      if (url.pathname === '/mkety-admin/operations' || url.pathname === '/mkety-admin/operations/') return htmlResponse(renderMketyAdminOperationsPage());
      if (url.pathname === '/api/v1/health') return healthResponse(request, env);
      if (url.pathname === '/api/v1/custom-hostname/probe') {
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => customHostnameRouteProofHandler(request, env, { hostnameStore: runtime.hostnames }), ctx);
        return customHostnameRouteProofHandler(request, env, {});
      }
      if (url.pathname === '/api/v1/public/branding') {
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => publicBrandingHandler(request, env, { persistenceRuntime: runtime }), ctx);
        return publicBrandingHandler(request, env, {});
      }
      if (url.pathname === '/api/v1/internal/source-event') return internalSourceHandler(request, env, { ctx });
      if (url.pathname.startsWith('/api/v1/internal/')) return notFoundResponse();
      if (['/api/v1/access/redeem', '/api/v1/access/session', '/api/v1/access/logout'].includes(url.pathname)) {
        if (!usePersistenceRuntime) return accessCodeRedeemHandler(request, env, { ctx });
        return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => accessCodeRedeemHandler(request, env, { ctx, store: runtime.accessCodes }), ctx);
      }
      if (url.pathname.startsWith('/api/v1/access/')) return notFoundResponse();
      if (url.pathname === '/api/v1/mkety-admin/operations') {
        if (!usePersistenceRuntime) return mketyAdminOperationsHandler(request, env, { ctx });
        return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => mketyAdminOperationsHandler(request, env, { ctx, operationsStore: createMketyAdminOperationsStore(runtime.operationJournal) }), ctx);
      }
      if (url.pathname.startsWith('/api/v1/mkety-admin/trade-repair/')) {
        if (!usePersistenceRuntime) return mketyAdminTradeRepairHandler(request, env, { ctx });
        return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => mketyAdminTradeRepairHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
      }
      if (url.pathname === '/api/v1/mkety-admin/access-codes' || url.pathname.startsWith('/api/v1/mkety-admin/access-codes/') || url.pathname.startsWith('/api/v1/mkety-admin/test-workspaces/') || url.pathname === '/api/v1/mkety-admin/runtime-controls') {
        if (!usePersistenceRuntime) return mketyAdminAccessCodesHandler(request, env, { ctx });
        return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => mketyAdminAccessCodesHandler(request, env, { ctx, store: runtime.accessCodes, runtimeStore: runtime.runtimeControls }), ctx);
      }
      if (url.pathname.startsWith('/api/v1/mkety-admin/')) return notFoundResponse();
      if (/^\/api\/v1\/external\/mtproto\/[^/]+\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => externalMtprotoHandler(request, env, {
          ctx,
          resolveActiveSource: (sourceId) => runtime.ingest.sourceStore.getActiveSource(sourceId),
          eventsHandler: (signedRequest, signedEnv, options = {}) => eventsHandler(signedRequest, signedEnv, Object.assign(Object.create(ctx ? Object.getPrototypeOf(ctx) : Object.prototype), ctx || {}, { ...options, persistenceRuntime: runtime })),
        }), ctx);
        return externalMtprotoHandler(request, env, { ctx, eventsHandler });
      }
      if (url.pathname.startsWith('/api/v1/external/')) return notFoundResponse();
      if (url.pathname === '/api/v1/events') {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => eventsHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        return eventsHandler(request, env, { ctx });
      }
      if (/^\/api\/v1\/admin\/sources\/[^/]+\/ingress-secret$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (!usePersistenceRuntime) return sourceIngressSecretHandler(request, env, { ctx });
        return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => sourceIngressSecretHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
      }
      if (url.pathname.startsWith('/api/v1/admin/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return adminHandler(request, env, { ctx, ...(usePersistenceRuntime ? { persistenceRuntimeFactory, persistenceRuntime: ctx?.tradingPersistenceRuntime || null } : {}) });
      }
      if (url.pathname.startsWith('/api/v1/webhooks/tradingview/')) {
        if (!isTradingAccessEnabled(env) && !isTradingViewCertificateProbeRequest(url, env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => tradingViewHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        return tradingViewHandler(request, env, { ctx });
      }
      if (url.pathname.startsWith('/api/v1/webhooks/')) return notFoundResponse();
      if (url.pathname === '/api/webhook/process_signal') return retiredLegacySignalResponse();
      if (url.pathname.startsWith('/api/admin/')) return retiredLegacyAdminResponse();
      if (usePersistenceRuntime) return notFoundResponse();
      const activeLegacy = legacy || (await import('./index.js')).default;
      return activeLegacy.fetch(request, env, ctx);
    },
    async queue(batch, env, ctx) {
      if (persistenceRuntimeFactory && persistenceRuntimeEnabled(env)) {
        let persistenceRuntime;
        try { persistenceRuntime = await persistenceRuntimeFactory(env); }
        catch {
          const messages = Array.isArray(batch?.messages) ? batch.messages : [];
          for (const message of messages) if (typeof message?.retry === 'function') message.retry();
          return { processed: messages.length, acknowledged: 0, retried: messages.length, reason: 'TRADING_STORAGE_RUNTIME_UNAVAILABLE' };
        }
        try {
          const runtime = queueRuntime || createSourceQueueRuntime();
          return await runtime(batch, env, { ctx, persistenceRuntime });
        } catch {
          const messages = Array.isArray(batch?.messages) ? batch.messages : [];
          for (const message of messages) if (typeof message?.retry === 'function') message.retry();
          return { processed: messages.length, acknowledged: 0, retried: messages.length, reason: 'TRADING_STORAGE_QUEUE_RUNTIME_FAILED' };
        } finally { try { await persistenceRuntime?.close?.(); } catch { /* Preserve queue outcomes. */ } }
      }
      const runtime = queueRuntime || createSourceQueueRuntime();
      return runtime(batch, env, { ctx });
    },
    async scheduled(event, env, ctx) {
      if (persistenceRuntimeFactory && persistenceRuntimeEnabled(env)) {
        const runMtprotoRecovery = event?.cron === MTPROTO_RECOVERY_CRON;
        const runVipLifecycle = event?.cron === LEGACY_VIP_LIFECYCLE_CRON;
        if (!runMtprotoRecovery && !runVipLifecycle) return { skipped: true, reason: 'NO_TRADING_CRON_WORK' };
        let replicationRuntime;
        let runtime;
        try {
          runtime = await persistenceRuntimeFactory(env);
          let replication = { ok: true, skipped: true };
          if (runMtprotoRecovery) {
            replicationRuntime = await replicationRuntimeFactory(env, { postgresDatabase: runtime.postgresDatabase || null });
            replication = await replicationRuntime.run();
          }
          let vipLifecycle;
          if (runVipLifecycle) {
            const workspaces = await runtime.legacyWorkspaces.listBotEnabled();
            let processed = 0;
            for (const workspace of workspaces) {
              if (!workspace.tg_bot_token || !workspace.tg_vip_chat_id) continue;
              const manager = new VIPMembershipManager(null, workspace.tg_bot_token, workspace.tg_admin_chat_id, workspace.tg_vip_chat_id, workspace.id, { vipStore: runtime.vip });
              await manager.processSubscriptionLifecycleCron();
              processed += 1;
            }
            vipLifecycle = { ok: true, processedWorkspaces: processed };
          }
          const retryRuntime = destinationRetryRuntime || createProductionDestinationRetryRuntime();
          const repairRuntime = bindingRepairRuntime || runScheduledBindingRepairs;
          const tpProtectionRuntime = configuredBrokerTpProtectionRuntime || brokerTpProtectionRuntime;
          const orphanRuntime = configuredOrphanSignalRecoveryRuntime || orphanSignalRecoveryRuntime;
          const mtprotoRuntime = recoveryRuntime || createMtprotoRecoveryRuntime();
          const maintenanceDue = scheduledMaintenanceDue(event, env);
          const [retryResult, bindingRepairResult, pendingLifecycleResult, tpProtectionResult, orphanResult, mtprotoResult] = runMtprotoRecovery ? await Promise.allSettled([
            retryRuntime(env, { ctx, persistenceRuntime: runtime }),
            maintenanceDue ? repairRuntime(env, { ctx, persistenceRuntime: runtime }) : Promise.resolve({ skipped: true, reason: 'MAINTENANCE_INTERVAL' }),
            pendingOrderLifecycleRuntime(env, { ctx, persistenceRuntime: runtime }),
            tpProtectionRuntime(env, { ctx, persistenceRuntime: runtime }),
            maintenanceDue ? orphanRuntime(env, { ctx, persistenceRuntime: runtime }) : Promise.resolve({ skipped: true, reason: 'MAINTENANCE_INTERVAL' }),
            mtprotoRuntime(env, { ctx, persistenceRuntime: runtime }),
          ]) : Array.from({ length: 6 }, () => ({ status: 'fulfilled', value: { skipped: true } }));
          return {
            replication,
            ...(vipLifecycle ? { vipLifecycle } : {}),
            destinationRetryRecovery: retryResult.status === 'fulfilled' ? retryResult.value : { ok: false, reason: 'DESTINATION_RETRY_RECOVERY_FAILED' },
            bindingRepairRecovery: bindingRepairResult.status === 'fulfilled' ? bindingRepairResult.value : { ok: false, reason: 'BINDING_REPAIR_RECOVERY_FAILED' },
            pendingOrderLifecycle: pendingLifecycleResult.status === 'fulfilled' ? pendingLifecycleResult.value : { ok: false, reason: 'PENDING_ORDER_LIFECYCLE_FAILED' },
            brokerTpProtection: tpProtectionResult.status === 'fulfilled' ? tpProtectionResult.value : { ok: false, reason: 'BROKER_TP_PROTECTION_FAILED' },
            orphanSignalRecovery: orphanResult.status === 'fulfilled' ? orphanResult.value : { ok: false, reason: 'ORPHAN_SIGNAL_RECOVERY_FAILED' },
            mtprotoRecovery: mtprotoResult.status === 'fulfilled' ? mtprotoResult.value : { ok: false, reason: 'MTPROTO_RECOVERY_FAILED' },
            skippedOtherScheduledWork: false,
          };
        } catch {
          return { replication: { ok: false, reason: 'STORAGE_SCHEDULED_RUNTIME_UNAVAILABLE', retryOnNextCron: true }, skippedOtherScheduledWork: true };
        } finally {
          try { await runtime?.close?.(); } catch { /* Preserve the scheduled result. */ }
          try { await replicationRuntime?.close?.(); } catch { /* Preserve the scheduled result. */ }
        }
      }
      if (event?.cron === MTPROTO_RECOVERY_CRON) {
        const mtprotoRuntime = recoveryRuntime || createMtprotoRecoveryRuntime();
        const retryRuntime = destinationRetryRuntime || createProductionDestinationRetryRuntime();
        const repairRuntime = bindingRepairRuntime || runScheduledBindingRepairs;
        const orphanRuntime = configuredOrphanSignalRecoveryRuntime || orphanSignalRecoveryRuntime;
        const tpProtectionRuntime = configuredBrokerTpProtectionRuntime || brokerTpProtectionRuntime;
        const maintenanceDue = scheduledMaintenanceDue(event, env);
        const [mtprotoResult, orphanResult, retryResult, bindingRepairResult, pendingLifecycleResult, tpProtectionResult] = await Promise.allSettled([
          mtprotoRuntime(env, { ctx }),
          maintenanceDue ? orphanRuntime(env, { ctx }) : Promise.resolve({ skipped: true, reason: 'MAINTENANCE_INTERVAL' }),
          retryRuntime(env, { ctx }),
          maintenanceDue ? repairRuntime(env, { ctx }) : Promise.resolve({ skipped: true, reason: 'MAINTENANCE_INTERVAL' }),
          pendingOrderLifecycleRuntime(env, { ctx }),
          tpProtectionRuntime(env, { ctx }),
        ]);
        return { mtprotoRecovery: mtprotoResult.status, orphanSignalRecovery: orphanResult.status, destinationRetryRecovery: retryResult.status, bindingRepairRecovery: bindingRepairResult.status, pendingOrderLifecycle: pendingLifecycleResult.status, brokerTpProtection: tpProtectionResult.status };
      }
      const activeLegacy = legacy || (await import('./index.js')).default;
      if (typeof activeLegacy.scheduled === 'function') return activeLegacy.scheduled(event, env, ctx);
    },
  };
}

export default createTradingV1Entrypoint();
