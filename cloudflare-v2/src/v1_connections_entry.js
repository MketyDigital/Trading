import baseWorker from './v1_entry.js';
import { withUnifiedTradingConnections } from './dashboard_unified_connections.js';
import { withCTraderCbotConnections } from './dashboard_ctrader_cbot_connections.js';
import { withMt5ConnectorConnections } from './dashboard_mt5_connector_connections.js';
import { withTelegramBotSource } from './dashboard_telegram_bot_source.js';
import { handleV1AdminConnectionsRequest } from './http/v1_admin_connections_relay.js';
import { handleV1AdminCTraderCbotRequest } from './http/v1_admin_ctrader_cbot.js';
import { handleV1AdminMt5ConnectorRequest } from './http/v1_admin_mt5_connector.js';
import { handleCTraderOAuthPublicCallback } from './http/ctrader_oauth_callback.js';
import { handleCTraderOAuthRelayAuthorize } from './http/ctrader_oauth_relay.js';
import { handleExternalMtprotoEndpointRequest } from './http/external_mtproto_endpoint.js';
import { handleExternalMtprotoCollectorRequest } from './http/external_mtproto_collector_endpoint.js';
import { handleMketyAdminIngressCollectorsRequest } from './http/v1_mkety_admin_ingress_collectors.js';
import { handleExternalMt5BridgeRequest } from './http/external_mt5_bridge_endpoint.js';
import { handleTelegramBotWebhookRequest } from './http/telegram_bot_webhook.js';
import { handleTelegramBotAdminRequest } from './http/telegram_bot_admin.js';
import { isTradingAccessEnabled, tradingAccessDisabledResponse } from './security/trading_runtime_access.js';

export { MTProtoListenerNode, TradeStateNode, MtprotoContainerRuntime } from './v1_entry.js';

function isHtml(response) {
  return String(response?.headers?.get?.('Content-Type') || '').toLowerCase().includes('text/html');
}

async function enhancePortalResponse(response) {
  if (!response?.ok || !isHtml(response)) return response;
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(withTelegramBotSource(withMt5ConnectorConnections(withCTraderCbotConnections(withUnifiedTradingConnections(html)))), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createTradingConnectionsEntrypoint({
  base = baseWorker,
  connectionsHandler = handleV1AdminConnectionsRequest,
  ctraderCbotHandler = handleV1AdminCTraderCbotRequest,
  mt5ConnectorHandler = handleV1AdminMt5ConnectorRequest,
  ctraderCallbackHandler = handleCTraderOAuthPublicCallback,
  ctraderRelayAuthorizeHandler = handleCTraderOAuthRelayAuthorize,
  externalMtprotoHandler = handleExternalMtprotoEndpointRequest,
  externalMtprotoCollectorHandler = handleExternalMtprotoCollectorRequest,
  ingressCollectorsAdminHandler = handleMketyAdminIngressCollectorsRequest,
  mt5BridgeHandler = handleExternalMt5BridgeRequest,
  telegramBotWebhookHandler = handleTelegramBotWebhookRequest,
  telegramBotAdminHandler = handleTelegramBotAdminRequest,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

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
        return ctraderCbotHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/admin/connections/mt5/connector' || url.pathname.startsWith('/api/v1/admin/connections/mt5/connector/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return mt5ConnectorHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/admin/connections' || url.pathname.startsWith('/api/v1/admin/connections/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return connectionsHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/admin/sources' || /^\/api\/v1\/admin\/sources\/[^/]+\/(?:enable|disable|credentials)$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        const botAdminResponse = await telegramBotAdminHandler(request, env, { ctx });
        if (botAdminResponse) return botAdminResponse;
      }

      if (/^\/api\/v1\/webhooks\/telegram-bot\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return telegramBotWebhookHandler(request, env, { ctx });
      }

      if (/^\/api\/v1\/external\/mtproto\/collect(?:\/[^/]+)?$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return externalMtprotoCollectorHandler(request, env, { ctx });
      }

      if (/^\/api\/v1\/external\/mtproto\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return externalMtprotoHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/external/mt5/bridge' || /^\/api\/v1\/external\/mt5\/bridge\/[^/]+$/.test(url.pathname)) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return mt5BridgeHandler(request, env, { ctx });
      }

      const response = await base.fetch(request, env, ctx);
      if (url.pathname === '/' || url.pathname === '') return enhancePortalResponse(response);
      return response;
    },

    async queue(batch, env, ctx) {
      if (typeof base.queue === 'function') return base.queue(batch, env, ctx);
    },

    async scheduled(event, env, ctx) {
      if (typeof base.scheduled === 'function') return base.scheduled(event, env, ctx);
    },
  };
}

export default createTradingConnectionsEntrypoint();