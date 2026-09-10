import baseWorker from './v1_entry.js';
import { withUnifiedTradingConnections } from './dashboard_unified_connections.js';
import { handleV1AdminConnectionsRequest } from './http/v1_admin_connections.js';
import { handleCTraderOAuthPublicCallback } from './http/ctrader_oauth_callback.js';
import { handleExternalMtprotoEndpointRequest } from './http/external_mtproto_endpoint.js';
import { handleExternalMt5BridgeRequest } from './http/external_mt5_bridge_endpoint.js';
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
  return new Response(withUnifiedTradingConnections(html), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createTradingConnectionsEntrypoint({
  base = baseWorker,
  connectionsHandler = handleV1AdminConnectionsRequest,
  ctraderCallbackHandler = handleCTraderOAuthPublicCallback,
  externalMtprotoHandler = handleExternalMtprotoEndpointRequest,
  mt5BridgeHandler = handleExternalMt5BridgeRequest,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      if (url.pathname === '/api/v1/integrations/ctrader/callback') {
        return ctraderCallbackHandler(request, env, { ctx });
      }

      if (url.pathname === '/api/v1/admin/connections' || url.pathname.startsWith('/api/v1/admin/connections/')) {
        if (!isTradingAccessEnabled(env)) return tradingAccessDisabledResponse();
        return connectionsHandler(request, env, { ctx });
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
