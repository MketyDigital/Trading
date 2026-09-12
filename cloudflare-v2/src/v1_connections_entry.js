import baseWorker from './v1_entry.js';
import { withUnifiedTradingConnections } from './dashboard_unified_connections.js';
import { withCTraderCbotConnections } from './dashboard_ctrader_cbot_connections.js';
import { withMt5ConnectorConnections } from './dashboard_mt5_connector_connections.js';
import { withEnterpriseLiveExecutionControls } from './dashboard_live_execution_controls.js';
import { handleV1AdminConnectionsRequest } from './http/v1_admin_connections.js';
import { handleV1AdminCTraderCbotRequest } from './http/v1_admin_ctrader_cbot.js';
import { handleV1AdminMt5ConnectorRequest } from './http/v1_admin_mt5_connector.js';
import { handleCTraderOAuthPublicCallback } from './http/ctrader_oauth_callback.js';
import { handleExternalMtprotoEndpointRequest } from './http/external_mtproto_endpoint.js';
import { handleExternalMtprotoCollectorRequest } from './http/external_mtproto_collector_endpoint.js';
import { handleMketyAdminIngressCollectorsRequest } from './http/v1_mkety_admin_ingress_collectors.js';
import { handleExternalMt5BridgeRequest } from './http/external_mt5_bridge_endpoint.js';
import { resolveGlobalTradingAccess, tradingAccessDisabledResponse } from './security/trading_runtime_access.js';

export { MTProtoListenerNode, TradeStateNode, MtprotoContainerRuntime } from './v1_entry.js';

function isHtml(response) { return String(response?.headers?.get?.('Content-Type') || '').toLowerCase().includes('text/html'); }
async function enhancePortalResponse(response) {
  if (!response?.ok || !isHtml(response)) return response;
  const html = await response.text(); const headers = new Headers(response.headers); headers.set('Cache-Control', 'no-store');
  const enhanced = withEnterpriseLiveExecutionControls(withMt5ConnectorConnections(withCTraderCbotConnections(withUnifiedTradingConnections(html))));
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers });
}
async function tradingAccessBlock(env) {
  const control = await resolveGlobalTradingAccess(env);
  if (!control?.ok) return tradingAccessDisabledResponse('TRADING_RUNTIME_CONTROL_UNAVAILABLE');
  return control.enabled === true ? null : tradingAccessDisabledResponse();
}

export function createTradingConnectionsEntrypoint({
  base = baseWorker,
  connectionsHandler = handleV1AdminConnectionsRequest,
  ctraderCbotHandler = handleV1AdminCTraderCbotRequest,
  mt5ConnectorHandler = handleV1AdminMt5ConnectorRequest,
  ctraderCallbackHandler = handleCTraderOAuthPublicCallback,
  externalMtprotoHandler = handleExternalMtprotoEndpointRequest,
  externalMtprotoCollectorHandler = handleExternalMtprotoCollectorRequest,
  ingressCollectorsAdminHandler = handleMketyAdminIngressCollectorsRequest,
  mt5BridgeHandler = handleExternalMt5BridgeRequest,
} = {}) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (url.pathname === '/api/v1/integrations/ctrader/callback') return ctraderCallbackHandler(request, env, { ctx });
      if (url.pathname === '/api/v1/mkety-admin/ingress-collectors' || url.pathname.startsWith('/api/v1/mkety-admin/ingress-collectors/')) return ingressCollectorsAdminHandler(request, env, { ctx });
      if (url.pathname === '/api/v1/admin/connections/ctrader/cbot' || url.pathname.startsWith('/api/v1/admin/connections/ctrader/cbot/')) { const block = await tradingAccessBlock(env); if (block) return block; return ctraderCbotHandler(request, env, { ctx }); }
      if (url.pathname === '/api/v1/admin/connections/mt5/connector' || url.pathname.startsWith('/api/v1/admin/connections/mt5/connector/')) { const block = await tradingAccessBlock(env); if (block) return block; return mt5ConnectorHandler(request, env, { ctx }); }
      if (url.pathname === '/api/v1/admin/connections' || url.pathname.startsWith('/api/v1/admin/connections/')) { const block = await tradingAccessBlock(env); if (block) return block; return connectionsHandler(request, env, { ctx }); }
      if (/^\/api\/v1\/external\/mtproto\/collect(?:\/[^/]+)?$/.test(url.pathname)) { const block = await tradingAccessBlock(env); if (block) return block; return externalMtprotoCollectorHandler(request, env, { ctx }); }
      if (/^\/api\/v1\/external\/mtproto\/[^/]+$/.test(url.pathname)) { const block = await tradingAccessBlock(env); if (block) return block; return externalMtprotoHandler(request, env, { ctx }); }
      if (url.pathname === '/api/v1/external/mt5/bridge' || /^\/api\/v1\/external\/mt5\/bridge\/[^/]+$/.test(url.pathname)) { const block = await tradingAccessBlock(env); if (block) return block; return mt5BridgeHandler(request, env, { ctx }); }
      const response = await base.fetch(request, env, ctx);
      if (url.pathname === '/' || url.pathname === '') return enhancePortalResponse(response);
      return response;
    },
    async queue(batch, env, ctx) { if (typeof base.queue === 'function') return base.queue(batch, env, ctx); },
    async scheduled(event, env, ctx) { if (typeof base.scheduled === 'function') return base.scheduled(event, env, ctx); },
  };
}

export default createTradingConnectionsEntrypoint();
