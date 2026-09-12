import { clearCTraderRelayCookie, hasCTraderRelayCookie, readCTraderRelayContext } from './ctrader_oauth_relay.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function redirectLocation(origin, code, error) {
  const url = new URL('/', origin);
  if (error) url.searchParams.set('ctrader_error', error);
  else if (code) url.searchParams.set('ctrader_code', code);
  return url.toString();
}

async function relayCallback(request, env, code, error) {
  const relay = await readCTraderRelayContext(request, env);
  const headers = { 'Cache-Control': 'no-store', 'Set-Cookie': clearCTraderRelayCookie() };
  if (!relay) {
    return new Response(null, {
      status: 302,
      headers: { ...headers, Location: '/?ctrader_error=oauth_relay_invalid_or_expired' },
    });
  }
  if (!code && !error) return json({ ok: false, reason: 'CTRADER_OAUTH_CODE_MISSING' }, 400);
  return new Response(null, {
    status: 302,
    headers: { ...headers, Location: redirectLocation(relay.returnOrigin, code, error) },
  });
}

export function handleCTraderOAuthPublicCallback(request, env = {}) {
  if (request.method !== 'GET') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();
  const error = String(url.searchParams.get('error') || url.searchParams.get('errorCode') || '').trim();

  if (hasCTraderRelayCookie(request)) return relayCallback(request, env, code, error);

  if (error) {
    const location = `/?ctrader_error=${encodeURIComponent(error)}`;
    return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
  }
  if (!code) return json({ ok: false, reason: 'CTRADER_OAUTH_CODE_MISSING' }, 400);

  const location = `/?ctrader_code=${encodeURIComponent(code)}`;
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
