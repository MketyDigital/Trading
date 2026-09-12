const RELAY_COOKIE = 'mkety_ctrader_relay';
const RELAY_PATH = '/api/v1/integrations/ctrader';
const RELAY_TTL_SECONDS = 10 * 60;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function validOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function signCTraderRelay({ state, returnOrigin, secret, nowMs = Date.now(), ttlSeconds = RELAY_TTL_SECONDS } = {}) {
  const safeState = String(state || '').trim();
  const safeOrigin = validOrigin(returnOrigin);
  if (!safeState || !safeOrigin || !secret) throw new Error('CTRADER_OAUTH_RELAY_NOT_CONFIGURED');
  const payload = {
    v: 1,
    state: safeState,
    returnOrigin: safeOrigin,
    exp: Math.floor(nowMs / 1000) + Math.max(60, Math.min(Number(ttlSeconds) || RELAY_TTL_SECONDS, RELAY_TTL_SECONDS)),
  };
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(encoded));
  return `${encoded}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyCTraderRelay(token, secret, nowMs = Date.now()) {
  if (!token || !secret) return null;
  const [encoded, signature, extra] = String(token).split('.');
  if (!encoded || !signature || extra) return null;
  try {
    const ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(signature),
      new TextEncoder().encode(encoded),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
    const returnOrigin = validOrigin(payload?.returnOrigin);
    if (payload?.v !== 1 || !payload?.state || !returnOrigin) return null;
    if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= Math.floor(nowMs / 1000)) return null;
    return { state: String(payload.state), returnOrigin, exp: Number(payload.exp) };
  } catch {
    return null;
  }
}

function canonicalOrigin(env = {}) {
  try {
    const url = new URL(String(env.CTRADER_REDIRECT_URI || ''));
    if (url.protocol !== 'https:') throw new Error('invalid redirect');
    return url.origin;
  } catch {
    throw new Error('CTRADER_OAUTH_RELAY_NOT_CONFIGURED');
  }
}

function cTraderGrantUrl(env = {}) {
  if (!env.CTRADER_CLIENT_ID || !env.CTRADER_REDIRECT_URI) throw new Error('CTRADER_NOT_CONFIGURED');
  const url = new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/');
  url.searchParams.set('client_id', env.CTRADER_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.CTRADER_REDIRECT_URI);
  url.searchParams.set('scope', 'trading');
  url.searchParams.set('product', 'web');
  return url.toString();
}

export async function buildCTraderRelayAuthorizationUrl(request, env = {}, state) {
  const token = await signCTraderRelay({
    state,
    returnOrigin: new URL(request.url).origin,
    secret: env.TRADING_ACCESS_CODE_SESSION_SECRET,
  });
  const url = new URL('/api/v1/integrations/ctrader/authorize', canonicalOrigin(env));
  url.searchParams.set('relay', token);
  return url.toString();
}

function cookieValue(request, name) {
  const cookie = String(request.headers.get('Cookie') || '');
  for (const item of cookie.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return null;
}

export function hasCTraderRelayCookie(request) {
  return Boolean(cookieValue(request, RELAY_COOKIE));
}

export function clearCTraderRelayCookie() {
  return `${RELAY_COOKIE}=; Path=${RELAY_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function readCTraderRelayContext(request, env = {}) {
  return verifyCTraderRelay(cookieValue(request, RELAY_COOKIE), env.TRADING_ACCESS_CODE_SESSION_SECRET);
}

export async function handleCTraderOAuthRelayAuthorize(request, env = {}) {
  if (request.method !== 'GET') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  const url = new URL(request.url);
  if (url.origin !== canonicalOrigin(env)) return json({ ok: false, reason: 'CTRADER_OAUTH_RELAY_WRONG_ORIGIN' }, 400);
  const token = String(url.searchParams.get('relay') || '').trim();
  const relay = await verifyCTraderRelay(token, env.TRADING_ACCESS_CODE_SESSION_SECRET);
  if (!relay) return json({ ok: false, reason: 'CTRADER_OAUTH_RELAY_INVALID_OR_EXPIRED' }, 400);

  const maxAge = Math.max(1, Math.min(RELAY_TTL_SECONDS, relay.exp - Math.floor(Date.now() / 1000)));
  return new Response(null, {
    status: 302,
    headers: {
      Location: cTraderGrantUrl(env),
      'Cache-Control': 'no-store',
      'Set-Cookie': `${RELAY_COOKIE}=${token}; Path=${RELAY_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
    },
  });
}
