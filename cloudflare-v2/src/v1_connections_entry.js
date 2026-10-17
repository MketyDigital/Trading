import baseWorker, { createTradingV1Entrypoint } from './v1_entry.js';
import { VIPMembershipManager } from './vip/vip_manager.js';
import { withUnifiedTradingConnections } from './dashboard_unified_connections.js';
import { withSimplifiedAccountControls } from './dashboard_simplified_account_controls.js';
import { withCTraderCbotConnections } from './dashboard_ctrader_cbot_connections.js';
import { withMt5ConnectorConnections } from './dashboard_mt5_connector_connections.js';
import { withTelegramBotSource } from './dashboard_telegram_bot_source.js';
import { withGranularRoutingConsole } from './dashboard_granular_routing.js';
import { handleV1AdminConnectionsRequest } from './http/v1_admin_connections_account_controls.js';
import { handleV1AdminCTraderCbotRequest } from './http/v1_admin_ctrader_cbot.js';
import { handleV1AdminMt5ConnectorRequest } from './http/v1_admin_mt5_connector.js';
import { handleV1AdminEditInPlaceRequest, isEditInPlaceAdminRequest } from './http/v1_admin_edit_in_place.js';
import { handleV1AdminLogicalRoutesRequest, isLogicalRouteAdminRequest } from './http/v1_admin_logical_routes.js';
import { handleCTraderOAuthPublicCallback } from './http/ctrader_oauth_callback.js';
import { handleCTraderOAuthRelayAuthorize } from './http/ctrader_oauth_relay.js';
import { handleExternalMtprotoEndpointRequest } from './http/external_mtproto_endpoint.js';
import { handleExternalMtprotoCollectorRequest } from './http/external_mtproto_collector_endpoint.js';
import { createIngressCollectorStore, handleMketyAdminIngressCollectorsRequest } from './http/v1_mkety_admin_ingress_collectors.js';
import { handleExternalMt5BridgeRequest } from './http/external_mt5_bridge_endpoint.js';
import { handleTelegramBotWebhookRequest } from './http/telegram_bot_webhook.js';
import { handleTelegramBotAdminRequest } from './http/telegram_bot_admin.js';
import { isTradingAccessEnabled, tradingAccessDisabledResponse } from './security/trading_runtime_access.js';

export { MTProtoListenerNode, TradeStateNode, MtprotoContainerRuntime } from './v1_entry.js';

function isHtml(response) {
  return String(response?.headers?.get?.('Content-Type') || '').toLowerCase().includes('text/html');
}

function storageRuntimeUnavailable(reason = 'STORAGE_PATH_NOT_MIGRATED') {
  return new Response(JSON.stringify({ ok: false, reason }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function withTradingPersistenceRuntime(factory, env, handler, ctx = null) {
  if (ctx?.tradingPersistenceRuntime) return handler(ctx.tradingPersistenceRuntime);
  let runtime;
  try {
    runtime = await factory(env);
    return await handler(runtime);
  } catch {
    return storageRuntimeUnavailable('TRADING_STORAGE_RUNTIME_UNAVAILABLE');
  } finally {
    try { await runtime?.close?.(); } catch { /* Preserve the handler response. */ }
  }
}

async function enhancePortalResponse(response) {
  if (!response?.ok || !isHtml(response)) return response;
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(withGranularRoutingConsole(withTelegramBotSource(withMt5ConnectorConnections(withCTraderCbotConnections(withSimplifiedAccountControls(withUnifiedTradingConnections(html)))))), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createTradingConnectionsEntrypoint({
  base = null,
  connectionsHandler = handleV1AdminConnectionsRequest,
  ctraderCbotHandler = handleV1AdminCTraderCbotRequest,
  mt5ConnectorHandler = handleV1AdminMt5ConnectorRequest,
  editInPlaceHandler = handleV1AdminEditInPlaceRequest,
  logicalRoutesHandler = handleV1AdminLogicalRoutesRequest,
  ctraderCallbackHandler = handleCTraderOAuthPublicCallback,
  ctraderRelayAuthorizeHandler = handleCTraderOAuthRelayAuthorize,
  externalMtprotoHandler = handleExternalMtprotoEndpointRequest,
  externalMtprotoCollectorHandler = handleExternalMtprotoCollectorRequest,
  ingressCollectorsAdminHandler = handleMketyAdminIngressCollectorsRequest,
  mt5BridgeHandler = handleExternalMt5BridgeRequest,
  telegramBotWebhookHandler = handleTelegramBotWebhookRequest,
  telegramBotAdminHandler = handleTelegramBotAdminRequest,
  persistenceRuntimeFactory = null,
  persistenceRuntimeEnabled = () => true,
} = {}) {
  const activeBase = base || (persistenceRuntimeFactory ? createTradingV1Entrypoint({ persistenceRuntimeFactory, persistenceRuntimeEnabled }) : baseWorker);
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const usePersistenceRuntime = Boolean(persistenceRuntimeFactory && persistenceRuntimeEnabled(env));

      if (usePersistenceRuntime) {
        if (url.pathname === '/api/v1/mkety-admin/ingress-collectors' || url.pathname.startsWith('/api/v1/mkety-admin/ingress-collectors/')) {
          if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
          return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => ingressCollectorsAdminHandler(request, env, { ctx, store: createIngressCollectorStore(runtime.ingressCollectors) }), ctx);
        }
        if (url.pathname === '/api/v1/admin/connections' || url.pathname === '/api/v1/admin/connections/accounts' || /^\/api\/v1\/admin\/connections\/accounts\/[^/]+$/.test(url.pathname)) {
          if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
          return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => connectionsHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        }
        const supportedSourceDetailPath = /^\/api\/v1\/admin\/connections\/sources\/[^/]+$/.test(url.pathname);
        const supportedConnectorPath = url.pathname.startsWith('/api/v1/admin/connections/mt5/connector')
          || url.pathname.startsWith('/api/v1/admin/connections/ctrader/cbot');
        if (
          (url.pathname.startsWith('/api/v1/admin/connections/') && !supportedSourceDetailPath && !supportedConnectorPath && !['/api/v1/admin/connections/ctrader/start', '/api/v1/admin/connections/ctrader/complete'].includes(url.pathname))
        ) return storageRuntimeUnavailable();
        if (url.pathname.startsWith('/api/v1/admin/connections/') && !supportedConnectorPath) {
          if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
          return withTradingPersistenceRuntime(persistenceRuntimeFactory, env,
            (runtime) => connectionsHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        }
      }

      if (url.pathname === '/api/v1/integrations/ctrader/authorize') {
        return ctraderRelayAuthorizeHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/integrations/ctrader/callback') {
        return ctraderCallbackHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/mkety-admin/ingress-collectors' || url.pathname.startsWith('/api/v1/mkety-admin/ingress-collectors/')) {
        return ingressCollectorsAdminHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/admin/connections/ctrader/cbot' || url.pathname.startsWith('/api/v1/admin/connections/ctrader/cbot/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env,
          (runtime) => ctraderCbotHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        return ctraderCbotHandler(request, env, { ctx, persistenceRuntime: ctx?.tradingPersistenceRuntime || null });
      }

      if (url.pathname === '/api/v1/admin/connections/mt5/connector' || url.pathname.startsWith('/api/v1/admin/connections/mt5/connector/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env,
          (runtime) => mt5ConnectorHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        return mt5ConnectorHandler(request, env, { ctx, persistenceRuntime: ctx?.tradingPersistenceRuntime || null });
      }

      if (url.pathname === '/api/v1/admin/connections' || url.pathname.startsWith('/api/v1/admin/connections/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return connectionsHandler(request, env, { ctx, persistenceRuntime: ctx?.tradingPersistenceRuntime || null });
      }

      if (isLogicalRouteAdminRequest(request)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env,
          (runtime) => logicalRoutesHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        return logicalRoutesHandler(request, env, { ctx, persistenceRuntime: ctx?.tradingPersistenceRuntime || null });
      }

      if (isEditInPlaceAdminRequest(request)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env,
          (runtime) => editInPlaceHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        return editInPlaceHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/admin/sources' || /^\/api\/v1\/admin\/sources\/[^/]+\/(?:enable|disable|credentials)$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) {
          const botAdminResponse = await withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => telegramBotAdminHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
          if (botAdminResponse) return botAdminResponse;
        } else {
          const botAdminResponse = await telegramBotAdminHandler(request, env, { ctx });
          if (botAdminResponse) return botAdminResponse;
        }
      }

      if (url.pathname.startsWith('/api/webhook/telegram_bot/')) {
        if (usePersistenceRuntime) {
          if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
          let token;
          try { token = decodeURIComponent(url.pathname.slice('/api/webhook/telegram_bot/'.length)); }
          catch { return new Response('Unauthorized Bot Token', { status: 401 }); }
          return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, async (runtime) => {
            const workspace = await runtime.legacyWorkspaces.getByBotToken(token);
            if (!workspace) return new Response('Unauthorized Bot Token', { status: 401 });
            let update;
            try { update = await request.json(); } catch { return new Response('Invalid update', { status: 400 }); }
            const manager = new VIPMembershipManager(null, token, workspace.tg_admin_chat_id, workspace.tg_vip_chat_id, workspace.id, { vipStore: runtime.vip });
            return manager.handleWebhookUpdate(update);
          }, ctx);
        }
        return storageRuntimeUnavailable();
      }

      if (/^\/api\/v1\/webhooks\/telegram-bot\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => telegramBotWebhookHandler(request, env, { ctx, sourceStore: runtime.sourceConnections }), ctx);
        return telegramBotWebhookHandler(request, env, { ctx });
      }

      if (/^\/api\/v1\/external\/mtproto\/collect(?:\/[^/]+)?$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => externalMtprotoCollectorHandler(request, env, {
          ctx,
          resolveCollector: async (token) => { const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token))); const tokenHash = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); const collector = await runtime.ingressCollectors.getByTokenHash(tokenHash); if (collector?.is_active) await runtime.ingressCollectors.markSeen(collector.id); return collector?.is_active ? collector : null; },
          resolveSourcesForChat: (chatId, collector) => runtime.ingest.sourceStore.findActiveExternalMtprotoSourcesForChat(chatId, { externalIdentity: collector?.metadata?.external_identity ?? collector?.metadata?.externalIdentity ?? null }),
          eventsHandler: (signedRequest, signedEnv, options = {}) => activeBase.fetch(signedRequest, signedEnv, Object.assign(Object.create(ctx ? Object.getPrototypeOf(ctx) : Object.prototype), ctx || {}, { ...options, tradingPersistenceRuntime: runtime })),
        }), ctx);
        return externalMtprotoCollectorHandler(request, env, { ctx });
      }

      if (/^\/api\/v1\/external\/mtproto\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) return withTradingPersistenceRuntime(persistenceRuntimeFactory, env, (runtime) => externalMtprotoHandler(request, env, {
          ctx,
          resolveActiveSource: (sourceId) => runtime.ingest.sourceStore.getActiveSource(sourceId),
          eventsHandler: (signedRequest, signedEnv, options = {}) => activeBase.fetch(signedRequest, signedEnv, Object.assign(Object.create(ctx ? Object.getPrototypeOf(ctx) : Object.prototype), ctx || {}, { ...options, tradingPersistenceRuntime: runtime })),
        }), ctx);
        return externalMtprotoHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/external/mt5/bridge' || /^\/api\/v1\/external\/mt5\/bridge\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        if (usePersistenceRuntime) {
          return withTradingPersistenceRuntime(persistenceRuntimeFactory, env,
            (runtime) => mt5BridgeHandler(request, env, { ctx, persistenceRuntime: runtime }), ctx);
        }
        return mt5BridgeHandler(request, env, { ctx, persistenceRuntime: ctx?.tradingPersistenceRuntime || null });
      }

      const response = await activeBase.fetch(request, env, ctx);
      if (url.pathname === '/' || url.pathname === '') return enhancePortalResponse(response);
      return response;
    },

    async queue(batch, env, ctx) {
      if (typeof activeBase.queue === 'function') return activeBase.queue(batch, env, ctx);
    },

    async scheduled(event, env, ctx) {
      if (typeof activeBase.scheduled === 'function') return activeBase.scheduled(event, env, ctx);
    },
  };
}

export default createTradingConnectionsEntrypoint();
