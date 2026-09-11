import { createClient } from '@supabase/supabase-js';
import { authorizeV1AdminRequest } from './v1_admin.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { decryptConnectionCredentials, encryptConnectionCredentials } from '../security/connection_credentials.js';
import { createMt5ConnectorToken } from '../adapters/mt5_connector_protocol.js';
import { providerConfigWithSymbolCatalog } from '../execution/account_symbol_catalog.js';

const ACCOUNT_SELECT = 'id,workspace_id,account_label,platform,account_id,server_name,lot_sizing_type,lot_value,is_active,execution_enabled,safety_policy,fast_entry_policy,entry_zone_policy,credential_ciphertext,provider_mode,environment,roles,provider_config,created_at';
const ALLOWED_ROLES = new Set(['source', 'execution']);
const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

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

function normalizeHttpsUrl(value) {
  const raw = text(value);
  if (!raw) throw new Error('MT5_CONNECTOR_GATEWAY_URL_MISSING');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('MT5_CONNECTOR_GATEWAY_URL_INVALID'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('MT5_CONNECTOR_GATEWAY_URL_INVALID');
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeMt5WebSocketUrl(env = {}) {
  const raw = text(env.MT5_CONNECTOR_WS_URL) || text(env.CTRADER_CBOT_WS_URL);
  if (!raw) throw new Error('MT5_CONNECTOR_WS_URL_MISSING');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('MT5_CONNECTOR_WS_URL_INVALID'); }
  if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port !== '25345') {
    throw new Error('MT5_CONNECTOR_WS_URL_INVALID');
  }
  parsed.pathname = '/v1/mt5';
  return parsed.toString();
}

function gatewayConfig(env = {}) {
  const gatewayUrl = normalizeHttpsUrl(env.MT5_CONNECTOR_GATEWAY_URL || env.CTRADER_CBOT_GATEWAY_URL);
  const gatewayWebSocketUrl = normalizeMt5WebSocketUrl(env);
  if (!env.TRADING_MASTER_KEY || !env.CBOT_TOKEN_SIGNING_KEY || !env.CBOT_CONTROL_SECRET) {
    throw new Error('MT5_CONNECTOR_NOT_CONFIGURED');
  }
  return { gatewayUrl, gatewayWebSocketUrl };
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
  let gateway;
  try { gateway = gatewayConfig(env); }
  catch { return json({ ok: false, reason: 'MT5_CONNECTOR_NOT_CONFIGURED' }, 503); }

  const body = await readBody(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const label = text(body.label);
  if (!label) return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
  const requestedEnvironment = text(body.environment)?.toLowerCase() || null;
  if (requestedEnvironment && !['demo', 'live'].includes(requestedEnvironment)) {
    return json({ ok: false, reason: 'ACCOUNT_ENVIRONMENT_INVALID' }, 400);
  }

  const accountRowId = crypto.randomUUID();
  const issuedAt = Date.now();
  const configuredTtl = Number(env.MT5_CONNECTOR_TOKEN_TTL_MS);
  const ttlMs = Number.isFinite(configuredTtl) && configuredTtl > 0 ? configuredTtl : DEFAULT_TOKEN_TTL_MS;
  const oneTimeConnectionToken = await createMt5ConnectorToken({
    accountRowId,
    signingKey: env.CBOT_TOKEN_SIGNING_KEY,
    issuedAt,
    ttlMs,
  });
  const credentialCiphertext = await encryptConnectionCredentials('mt5_connector', {
    connectionToken: oneTimeConnectionToken,
    gatewayUrl: gateway.gatewayUrl,
    controlSecret: String(env.CBOT_CONTROL_SECRET),
  }, env.TRADING_MASTER_KEY);

  const row = {
    id: accountRowId,
    workspace_id: String(authorization.workspace.id),
    account_label: label,
    platform: 'mt5',
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
    provider_mode: 'mt5_connector',
    environment: requestedEnvironment,
    roles: normalizeRoles(body.roles),
    provider_config: {
      status: 'awaiting_connector',
      gatewayManaged: true,
      outboundOnly: true,
      requiresCustomerVps: false,
      websocketPort: 25345,
    },
  };

  const { data, error } = await supabase.from('trade_accounts').insert(row).select(ACCOUNT_SELECT).maybeSingle();
  if (error || !data) return json({ ok: false, reason: 'ACCOUNT_CREATE_FAILED' }, 503);
  return json({
    ok: true,
    account: publicAccount(data),
    gatewayWebSocketUrl: gateway.gatewayWebSocketUrl,
    oneTimeConnectionToken,
    connectionTokenExpiresAt: new Date(issuedAt + ttlMs).toISOString(),
  }, 201);
}

async function syncConnection(accountRowId, authorization, supabase, env, fetchFn) {
  if (!hasTradingPermission(authorization?.membership?.role, 'accounts.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }
  if (!env.TRADING_MASTER_KEY) return json({ ok: false, reason: 'ACCOUNT_ENCRYPTION_NOT_CONFIGURED' }, 503);
  const workspaceId = String(authorization.workspace.id);
  const { data: current, error: readError } = await supabase
    .from('trade_accounts')
    .select(ACCOUNT_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('id', accountRowId)
    .maybeSingle();
  if (readError) return json({ ok: false, reason: 'ACCOUNT_READ_FAILED' }, 503);
  if (!current) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
  if (String(current.platform || '').toLowerCase() !== 'mt5' || String(current.provider_mode || '').toLowerCase() !== 'mt5_connector') {
    return json({ ok: false, reason: 'MT5_CONNECTOR_ACCOUNT_REQUIRED' }, 409);
  }

  let credentials;
  try {
    credentials = await decryptConnectionCredentials('mt5_connector', current.credential_ciphertext, env.TRADING_MASTER_KEY);
  } catch {
    return json({ ok: false, reason: 'MT5_CONNECTOR_CREDENTIALS_UNAVAILABLE' }, 503);
  }
  let gatewayUrl;
  try { gatewayUrl = normalizeHttpsUrl(credentials.gatewayUrl); }
  catch { return json({ ok: false, reason: 'MT5_CONNECTOR_CREDENTIALS_UNAVAILABLE' }, 503); }
  const controlSecret = text(credentials.controlSecret);
  if (!controlSecret) return json({ ok: false, reason: 'MT5_CONNECTOR_CREDENTIALS_UNAVAILABLE' }, 503);

  let gatewayResponse;
  try {
    gatewayResponse = await fetchFn(`${gatewayUrl}/v1/mt5-connections/${encodeURIComponent(accountRowId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return json({ ok: false, reason: 'MT5_CONNECTOR_GATEWAY_UNAVAILABLE' }, 503);
  }
  let gateway;
  try { gateway = await gatewayResponse.json(); }
  catch { return json({ ok: false, reason: 'MT5_CONNECTOR_GATEWAY_INVALID_RESPONSE' }, 503); }
  if (!gatewayResponse.ok || gateway?.ok === false || gateway?.online !== true) {
    return json({ ok: false, reason: gateway?.reason || 'MT5_CONNECTOR_OFFLINE' }, gatewayResponse.status === 404 ? 409 : 503);
  }
  if (String(gateway.accountRowId || '') !== String(accountRowId)) {
    return json({ ok: false, reason: 'MT5_CONNECTOR_IDENTITY_MISMATCH' }, 409);
  }

  const identity = gateway.identity && typeof gateway.identity === 'object' ? gateway.identity : {};
  const accountNumber = text(identity.accountNumber);
  const serverName = text(identity.serverName);
  if (!accountNumber || !serverName) return json({ ok: false, reason: 'MT5_CONNECTOR_IDENTITY_INCOMPLETE' }, 409);
  const observedEnvironment = identity.isLive === true ? 'live' : 'demo';
  if (current.environment && String(current.environment).toLowerCase() !== observedEnvironment) {
    return json({ ok: false, reason: 'MT5_CONNECTOR_ENVIRONMENT_MISMATCH' }, 409);
  }

  const baseProviderConfig = {
    ...(current.provider_config && typeof current.provider_config === 'object' ? current.provider_config : {}),
    status: 'connected',
    gatewayManaged: true,
    outboundOnly: true,
    requiresCustomerVps: false,
    websocketPort: 25345,
    brokerName: text(identity.brokerName),
    terminalName: text(identity.terminalName),
    connectorInstanceId: text(identity.connectorInstanceId),
    connectedAt: Number.isFinite(Number(gateway.connectedAt)) ? new Date(Number(gateway.connectedAt)).toISOString() : null,
    lastHeartbeatAt: Number.isFinite(Number(gateway.lastHeartbeatAt)) ? new Date(Number(gateway.lastHeartbeatAt)).toISOString() : null,
  };
  const providerConfig = providerConfigWithSymbolCatalog(baseProviderConfig, identity.symbols || [], {
    updatedAt: Number.isFinite(Number(identity.symbolsUpdatedAt))
      ? new Date(Number(identity.symbolsUpdatedAt)).toISOString()
      : new Date().toISOString(),
  });
  const patch = {
    account_id: accountNumber,
    server_name: serverName,
    environment: observedEnvironment,
    provider_config: providerConfig,
  };
  const { data: updated, error: updateError } = await supabase
    .from('trade_accounts')
    .update(patch)
    .eq('workspace_id', workspaceId)
    .eq('id', accountRowId)
    .select(ACCOUNT_SELECT)
    .maybeSingle();
  if (updateError || !updated) return json({ ok: false, reason: 'MT5_CONNECTOR_SYNC_FAILED' }, 503);
  return json({ ok: true, account: publicAccount(updated) });
}

export async function handleV1AdminMt5ConnectorRequest(request, env = {}, {
  supabaseFactory = defaultSupabase,
  authorizeFn = authorizeV1AdminRequest,
  fetchFn = fetch,
} = {}) {
  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503); }
  const authorization = await authorizeFn(request, env, { supabase });
  if (!authorization?.ok) {
    return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);
  }

  const url = new URL(request.url);
  if (url.pathname === '/api/v1/admin/connections/mt5/connector') {
    if (request.method === 'POST') return createConnection(request, authorization, supabase, env);
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }
  const syncMatch = url.pathname.match(/^\/api\/v1\/admin\/connections\/mt5\/connector\/([^/]+)\/sync$/);
  if (syncMatch) {
    if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
    let accountRowId;
    try { accountRowId = decodeURIComponent(syncMatch[1]); }
    catch { return json({ ok: false, reason: 'ACCOUNT_ID_INVALID' }, 400); }
    return syncConnection(accountRowId, authorization, supabase, env, fetchFn);
  }
  return json({ ok: false, reason: 'MT5_CONNECTOR_ROUTE_NOT_FOUND' }, 404);
}
