import { createClient } from '@supabase/supabase-js';
import { authorizeV1AdminRequest } from './v1_admin.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { encryptConnectionCredentials } from '../security/connection_credentials.js';
import { createCTraderCbotConnectionToken } from '../adapters/ctrader_cbot_protocol.js';

const ACCOUNT_SELECT = 'id,workspace_id,account_label,platform,account_id,server_name,lot_sizing_type,lot_value,is_active,execution_enabled,safety_policy,fast_entry_policy,entry_zone_policy,credential_ciphertext,provider_mode,environment,roles,provider_config,created_at';
const ALLOWED_ROLES = new Set(['source', 'execution']);
const DEFAULT_CONNECTION_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function text(value, fallback = null) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function randomToken(bytes = 12) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizeRoles(value) {
  const input = Array.isArray(value) ? value : ['execution'];
  const roles = [...new Set(input.map((role) => String(role ?? '').trim().toLowerCase()).filter((role) => ALLOWED_ROLES.has(role)))];
  return roles.length ? roles : ['execution'];
}

function normalizeHttpsUrl(value, label) {
  const raw = text(value);
  if (!raw) throw new Error(`${label}_MISSING`);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${label}_INVALID`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label}_INVALID`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeWebSocketUrl(value) {
  const raw = text(value);
  if (!raw) throw new Error('CTRADER_CBOT_WS_URL_MISSING');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('CTRADER_CBOT_WS_URL_INVALID'); }
  if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port !== '25345') {
    throw new Error('CTRADER_CBOT_WS_URL_INVALID');
  }
  return parsed.toString();
}

function readiness(env = {}) {
  try {
    return Boolean(
      env.TRADING_MASTER_KEY &&
      env.CBOT_TOKEN_SIGNING_KEY &&
      env.CBOT_CONTROL_SECRET &&
      normalizeHttpsUrl(env.CTRADER_CBOT_GATEWAY_URL, 'CTRADER_CBOT_GATEWAY_URL') &&
      normalizeWebSocketUrl(env.CTRADER_CBOT_WS_URL),
    );
  } catch {
    return false;
  }
}

async function defaultSupabase(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  return createClient(url, key);
}

function publicAccount(row = {}) {
  const safety = row.safety_policy && typeof row.safety_policy === 'object' ? row.safety_policy : {};
  return {
    id: row.id,
    label: row.account_label ?? null,
    platform: row.platform ?? null,
    providerMode: row.provider_mode ?? null,
    accountId: row.account_id ?? null,
    serverName: row.server_name ?? null,
    environment: row.environment ?? null,
    roles: normalizeRoles(row.roles),
    providerConfig: row.provider_config && typeof row.provider_config === 'object' ? row.provider_config : {},
    active: Boolean(row.is_active),
    executionEnabled: Boolean(row.execution_enabled),
    killSwitch: safety.killSwitch !== false,
    credentialConfigured: Boolean(row.credential_ciphertext),
    lotSizingType: row.lot_sizing_type ?? 'fixed',
    lotValue: row.lot_value ?? null,
    createdAt: row.created_at ?? null,
  };
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

async function createConnection(request, authorization, supabase, env) {
  if (!hasTradingPermission(authorization?.membership?.role, 'accounts.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }
  if (!readiness(env)) return json({ ok: false, reason: 'CTRADER_CBOT_NOT_CONFIGURED' }, 503);
  const body = await readBody(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const label = text(body.label);
  if (!label) return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
  const requestedEnvironment = text(body.environment)?.toLowerCase() || null;
  if (requestedEnvironment && !['demo', 'live'].includes(requestedEnvironment)) {
    return json({ ok: false, reason: 'ACCOUNT_ENVIRONMENT_INVALID' }, 400);
  }

  const gatewayUrl = normalizeHttpsUrl(env.CTRADER_CBOT_GATEWAY_URL, 'CTRADER_CBOT_GATEWAY_URL');
  const gatewayWebSocketUrl = normalizeWebSocketUrl(env.CTRADER_CBOT_WS_URL);
  const accountRowId = crypto.randomUUID();
  const issuedAt = Date.now();
  const configuredTtl = Number(env.CTRADER_CBOT_TOKEN_TTL_MS);
  const ttlMs = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : DEFAULT_CONNECTION_TOKEN_TTL_MS;
  const oneTimeConnectionToken = await createCTraderCbotConnectionToken({
    accountRowId,
    signingKey: env.CBOT_TOKEN_SIGNING_KEY,
    issuedAt,
    ttlMs,
  });
  const credentialCiphertext = await encryptConnectionCredentials('ctrader_cbot', {
    connectionToken: oneTimeConnectionToken,
    gatewayUrl,
    controlSecret: String(env.CBOT_CONTROL_SECRET),
  }, env.TRADING_MASTER_KEY);

  const row = {
    id: accountRowId,
    workspace_id: String(authorization.workspace.id),
    account_label: label,
    platform: 'ctrader',
    account_id: `pending:${randomToken(12)}`,
    server_name: null,
    lot_sizing_type: 'fixed',
    lot_value: Number(body.lotValue) > 0 ? Number(body.lotValue) : 0.01,
    is_active: false,
    execution_enabled: false,
    safety_policy: { killSwitch: true },
    fast_entry_policy: {},
    entry_zone_policy: {},
    credential_ciphertext: credentialCiphertext,
    provider_mode: 'ctrader_cbot',
    environment: requestedEnvironment,
    roles: normalizeRoles(body.roles),
    provider_config: {
      status: 'awaiting_cbot',
      gatewayManaged: true,
      requiresCustomerVps: false,
      websocketPort: 25345,
    },
  };

  const { data, error } = await supabase.from('trade_accounts').insert(row).select(ACCOUNT_SELECT).maybeSingle();
  if (error || !data) return json({ ok: false, reason: 'ACCOUNT_CREATE_FAILED' }, 503);
  return json({
    ok: true,
    account: publicAccount(data),
    gatewayWebSocketUrl,
    oneTimeConnectionToken,
    connectionTokenExpiresAt: new Date(issuedAt + ttlMs).toISOString(),
  }, 201);
}

export async function handleV1AdminCTraderCbotRequest(request, env = {}, {
  supabaseFactory = defaultSupabase,
  authorizeFn = authorizeV1AdminRequest,
} = {}) {
  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503); }
  const authorization = await authorizeFn(request, env, { supabase });
  if (!authorization?.ok) {
    return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);
  }

  const url = new URL(request.url);
  if (url.pathname === '/api/v1/admin/connections/ctrader/cbot') {
    if (request.method === 'POST') return createConnection(request, authorization, supabase, env);
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }
  return json({ ok: false, reason: 'CTRADER_CBOT_ROUTE_NOT_FOUND' }, 404);
}
