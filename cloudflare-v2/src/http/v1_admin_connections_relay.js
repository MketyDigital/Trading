import { handleV1AdminConnectionsRequest as baseHandler } from './v1_admin_connections.js';
import { buildCTraderRelayAuthorizationUrl } from './ctrader_oauth_relay.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleV1AdminConnectionsRequest(request, env = {}, dependencies = {}) {
  const response = await baseHandler(request, env, dependencies);
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== '/api/v1/admin/connections/ctrader/start' || !response.ok) return response;

  let body;
  try { body = await response.clone().json(); }
  catch { return response; }
  if (!body?.ok || !body?.state) return response;

  try {
    const authorizationUrl = await buildCTraderRelayAuthorizationUrl(request, env, body.state);
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify({ ...body, authorizationUrl }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return json({ ok: false, reason: 'CTRADER_OAUTH_RELAY_NOT_CONFIGURED' }, 503);
  }
}
