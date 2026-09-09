import { normalizeTradingHostname } from './trading_hostname_resolver.js';

const encoder = new TextEncoder();

function requiredSecret(env = {}) {
  const secret = String(env.TRADING_ACCESS_CODE_SESSION_SECRET ?? '').trim();
  if (!secret) throw new Error('CUSTOM_HOSTNAME_ROUTE_PROOF_SECRET_MISSING');
  return secret;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(message)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeNonce(value) {
  const nonce = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{16,160}$/.test(nonce) ? nonce : null;
}

function proofMessage(hostname, workspaceId, nonce) {
  return `${normalizeTradingHostname(hostname)}\n${String(workspaceId)}\n${String(nonce)}`;
}

function constantTimeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function findHostnameMapping(supabase, hostname) {
  if (!supabase?.from) throw new Error('CUSTOM_HOSTNAME_ROUTE_PROOF_STORE_UNAVAILABLE');
  const { data, error } = await supabase
    .from('trading_workspace_hostnames')
    .select('hostname,workspace_id,status')
    .eq('hostname', normalizeTradingHostname(hostname))
    .maybeSingle();
  if (error) throw new Error('CUSTOM_HOSTNAME_ROUTE_PROOF_LOOKUP_FAILED');
  return data || null;
}

export async function handleCustomHostnameRouteProofRequest(request, env = {}, { supabase } = {}) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, reason: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET', 'Cache-Control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const hostname = normalizeTradingHostname(url.hostname);
  const nonce = safeNonce(url.searchParams.get('nonce'));
  if (!hostname || !nonce) {
    return new Response(JSON.stringify({ ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROOF_INVALID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  let mapping;
  try { mapping = await findHostnameMapping(supabase, hostname); }
  catch {
    return new Response(JSON.stringify({ ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROOF_UNAVAILABLE' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  if (!mapping?.workspace_id) {
    return new Response(JSON.stringify({ ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROOF_NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  let proof;
  try { proof = await hmacHex(requiredSecret(env), proofMessage(hostname, mapping.workspace_id, nonce)); }
  catch {
    return new Response(JSON.stringify({ ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROOF_UNAVAILABLE' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  return new Response(JSON.stringify({ ok: true, service: 'mkety-trading-v1', hostname, nonce, proof }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function probeCustomHostnameRoute(hostname, expectedWorkspaceId, env = {}, { fetchFn = fetch, nonceFactory = () => crypto.randomUUID().replace(/-/g, '') } = {}) {
  const normalized = normalizeTradingHostname(hostname);
  const workspaceId = String(expectedWorkspaceId ?? '').trim();
  if (!normalized || !workspaceId || typeof fetchFn !== 'function') return { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_INVALID' };

  const nonce = safeNonce(nonceFactory());
  if (!nonce) return { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_INVALID' };

  let response;
  try {
    response = await fetchFn(`https://${normalized}/api/v1/custom-hostname/probe?nonce=${encodeURIComponent(nonce)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
    });
  } catch {
    return { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_FAILED' };
  }
  if (!response?.ok) return { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_FAILED' };

  let body;
  try { body = await response.json(); }
  catch { return { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_INVALID_RESPONSE' }; }

  if (body?.ok !== true || body?.service !== 'mkety-trading-v1' || normalizeTradingHostname(body?.hostname) !== normalized || body?.nonce !== nonce || !body?.proof) {
    return { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_INVALID_RESPONSE' };
  }

  let expectedProof;
  try { expectedProof = await hmacHex(requiredSecret(env), proofMessage(normalized, workspaceId, nonce)); }
  catch { return { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_UNAVAILABLE' }; }

  if (!constantTimeEqual(body.proof, expectedProof)) return { ok: false, reason: 'TRADING_HOSTNAME_WORKSPACE_MISMATCH' };
  return { ok: true, hostname: normalized, workspaceId };
}
