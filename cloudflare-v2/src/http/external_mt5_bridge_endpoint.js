import { createClient } from '@supabase/supabase-js';
import { decryptConnectionCredentials, encryptConnectionCredentials } from '../security/connection_credentials.js';
import { signMT5MetadataRequest } from '../adapters/mt5_bridge_protocol.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function constantTimeEqual(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bridgeSecret(request) {
  const authorization = String(request.headers.get('Authorization') || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return String(request.headers.get('X-Mkety-Bridge-Secret') || '').trim();
}

function bridgeAccountRowId(request) {
  const header = String(request.headers.get('X-Mkety-Bridge-Account-Id') || '').trim();
  if (header) return header;
  const match = new URL(request.url).pathname.match(/^\/api\/v1\/external\/mt5\/bridge\/([^/]+)$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRuntimeBridgeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('MT5_BRIDGE_URL_INVALID');
  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('MT5_BRIDGE_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('MT5_BRIDGE_URL_INVALID');
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.includes('/api/v1/external/mt5/bridge')) throw new Error('MT5_BRIDGE_URL_INVALID');
  url.pathname = pathname || '/';
  return url.toString().replace(/\/$/, '');
}

async function defaultSupabase(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('BRIDGE_DATABASE_UNAVAILABLE');
  return createClient(url, key);
}

async function readBridgeMetadata({ baseUrl, target, secret, fetchImpl, timestampMs }) {
  const signature = await signMT5MetadataRequest({ method: 'GET', target, timestamp: timestampMs, secret });
  const response = await fetchImpl(`${baseUrl}${target}`, {
    method: 'GET',
    headers: {
      'X-Mkety-Timestamp': String(timestampMs),
      'X-Mkety-Signature': signature,
      'Cache-Control': 'no-store',
    },
  });
  if (!response?.ok) throw new Error('MT5_BRIDGE_VERIFICATION_FAILED');
  const payload = await response.json();
  if (!payload || typeof payload !== 'object' || payload.ok === false) throw new Error('MT5_BRIDGE_VERIFICATION_FAILED');
  return payload;
}

export async function handleExternalMt5BridgeRequest(request, env = {}, {
  supabaseFactory = defaultSupabase,
  decryptCredentials = decryptConnectionCredentials,
  encryptCredentials = encryptConnectionCredentials,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  if (!env.TRADING_MASTER_KEY) return json({ ok: false, reason: 'BRIDGE_ENCRYPTION_NOT_CONFIGURED' }, 503);

  const rowId = bridgeAccountRowId(request);
  const secret = bridgeSecret(request);
  if (!rowId) return json({ ok: false, reason: 'MT5_BRIDGE_ACCOUNT_ID_REQUIRED' }, 400);
  if (!secret) return json({ ok: false, reason: 'MT5_BRIDGE_AUTH_REQUIRED' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  }
  const actualAccountId = String(body?.accountId ?? body?.login ?? '').trim();
  if (!actualAccountId) return json({ ok: false, reason: 'MT5_ACCOUNT_ID_REQUIRED' }, 400);
  const environment = String(body?.environment ?? '').trim().toLowerCase();
  if (environment && !['demo', 'live'].includes(environment)) return json({ ok: false, reason: 'ACCOUNT_ENVIRONMENT_INVALID' }, 400);

  let runtimeBridgeUrl;
  try { runtimeBridgeUrl = normalizeRuntimeBridgeUrl(body?.bridgeUrl); }
  catch { return json({ ok: false, reason: 'MT5_BRIDGE_URL_INVALID' }, 400); }

  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'BRIDGE_DATABASE_UNAVAILABLE' }, 503); }

  const select = 'id,workspace_id,platform,provider_mode,account_id,server_name,credential_ciphertext,provider_config,is_active,execution_enabled,safety_policy';
  const { data: account, error: readError } = await supabase.from('trade_accounts').select(select).eq('id', rowId).maybeSingle();
  if (readError) return json({ ok: false, reason: 'MT5_BRIDGE_ACCOUNT_READ_FAILED' }, 503);
  if (!account || account.platform !== 'mt5' || account.provider_mode !== 'mt5_bridge' || !account.credential_ciphertext) {
    return json({ ok: false, reason: 'MT5_BRIDGE_ACCOUNT_NOT_FOUND' }, 404);
  }

  let credentials;
  try { credentials = await decryptCredentials('mt5', account.credential_ciphertext, env.TRADING_MASTER_KEY); }
  catch { return json({ ok: false, reason: 'MT5_BRIDGE_CREDENTIAL_READ_FAILED' }, 503); }
  if (!constantTimeEqual(secret, credentials.bridgeSecret)) return json({ ok: false, reason: 'MT5_BRIDGE_AUTH_INVALID' }, 401);

  const current = now();
  const timestampMs = current instanceof Date ? current.getTime() : Number(current);
  if (!Number.isFinite(timestampMs)) return json({ ok: false, reason: 'MT5_BRIDGE_VERIFICATION_FAILED' }, 503);

  let bridgeAccount;
  try {
    await readBridgeMetadata({ baseUrl: runtimeBridgeUrl, target: '/v1/health', secret: credentials.bridgeSecret, fetchImpl, timestampMs });
    bridgeAccount = await readBridgeMetadata({ baseUrl: runtimeBridgeUrl, target: '/v1/account', secret: credentials.bridgeSecret, fetchImpl, timestampMs });
  } catch {
    return json({ ok: false, reason: 'MT5_BRIDGE_VERIFICATION_FAILED' }, 502);
  }

  const observedAccountId = String(bridgeAccount?.account_id ?? bridgeAccount?.accountId ?? bridgeAccount?.login ?? '').trim();
  if (!observedAccountId || observedAccountId !== actualAccountId) {
    return json({ ok: false, reason: 'MT5_BRIDGE_ACCOUNT_MISMATCH' }, 409);
  }
  const submittedServer = String(body?.serverName ?? body?.server ?? '').trim();
  const observedServer = String(bridgeAccount?.server_name ?? bridgeAccount?.serverName ?? bridgeAccount?.server ?? '').trim();
  if (submittedServer && observedServer && submittedServer !== observedServer) {
    return json({ ok: false, reason: 'MT5_BRIDGE_SERVER_MISMATCH' }, 409);
  }

  let credentialCiphertext;
  try {
    credentialCiphertext = await encryptCredentials('mt5', {
      bridgeUrl: runtimeBridgeUrl,
      bridgeSecret: credentials.bridgeSecret,
    }, env.TRADING_MASTER_KEY);
  } catch {
    return json({ ok: false, reason: 'MT5_BRIDGE_CREDENTIAL_WRITE_FAILED' }, 503);
  }

  const timestamp = new Date(timestampMs).toISOString();
  const providerConfig = {
    ...safeObject(account.provider_config),
    status: 'connected',
    requiresRunningTerminal: true,
    broker: String(body?.broker ?? '').trim() || null,
    terminalName: String(body?.terminalName ?? '').trim() || null,
    bridgeUrlVerifiedAt: timestamp,
    lastPairedAt: timestamp,
    lastHeartbeatAt: timestamp,
  };
  const update = {
    account_id: actualAccountId,
    server_name: submittedServer || observedServer || null,
    environment: environment || null,
    provider_config: providerConfig,
    credential_ciphertext: credentialCiphertext,
  };
  const { data, error } = await supabase.from('trade_accounts').update(update).eq('id', rowId).select('id,account_id,server_name,environment,provider_mode,provider_config,is_active,execution_enabled,safety_policy').maybeSingle();
  if (error || !data) return json({ ok: false, reason: 'MT5_BRIDGE_PAIRING_FAILED' }, 503);

  return json({
    ok: true,
    paired: true,
    account: {
      id: data.id,
      accountId: data.account_id,
      serverName: data.server_name,
      environment: data.environment,
      providerMode: data.provider_mode,
      status: data.provider_config?.status || 'connected',
      active: Boolean(data.is_active),
      executionEnabled: Boolean(data.execution_enabled),
      killSwitch: data.safety_policy?.killSwitch !== false,
    },
  });
}
