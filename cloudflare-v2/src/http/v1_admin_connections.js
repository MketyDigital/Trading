import { createClient } from '@supabase/supabase-js';
import { authorizeV1AdminRequest } from './v1_admin.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { encryptConnectionCredentials } from '../security/connection_credentials.js';
import { CTraderJsonSession } from '../adapters/ctrader_session.js';
import { ctraderEndpoint, buildAccountsByAccessTokenMessage } from '../adapters/ctrader_protocol.js';

const SOURCE_SECRET_KEY_PATTERN = /(secret|cipher|session|token|password|api[_-]?hash|api[_-]?key|access[_-]?key|refresh[_-]?key|credential|authorization|private[_-]?key)/i;
const ACCOUNT_SELECT = 'id,workspace_id,account_label,platform,account_id,server_name,lot_sizing_type,lot_value,is_active,execution_enabled,safety_policy,fast_entry_policy,entry_zone_policy,credential_ciphertext,provider_mode,environment,roles,provider_config,created_at';
const SOURCE_SELECT = 'id,workspace_id,source_type,source_instance_id,display_name,is_active,source_family,provider_type,is_default,priority,external_identity,public_source_handle,config,provider_secret_ciphertext,health_status,last_heartbeat_at,last_event_at,last_connected_at,last_disconnected_at,restart_count,last_error_code';
const ALLOWED_ROLES = new Set(['source', 'execution']);

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function safeText(value, fallback = null) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function sanitizeConnectionConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizeConnectionConfig);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SOURCE_SECRET_KEY_PATTERN.test(key)) continue;
    output[key] = sanitizeConnectionConfig(item);
  }
  return output;
}

export function normalizeConnectionRoles(value, fallback = ['source']) {
  const input = Array.isArray(value) ? value : fallback;
  const roles = [...new Set(input.map((role) => String(role ?? '').trim().toLowerCase()).filter((role) => ALLOWED_ROLES.has(role)))];
  return roles.length ? roles : [...fallback];
}

function canonicalOrigin(env = {}, requestUrl = null) {
  const configured = String(env.TRADING_CANONICAL_HOSTS ?? '').split(',').map((x) => x.trim()).filter(Boolean)[0];
  if (configured) return `https://${configured.replace(/^https?:\/\//i, '').split('/')[0]}`;
  if (requestUrl) return new URL(requestUrl).origin;
  return 'https://trade.mkety.com';
}

export function connectionReadiness(env = {}) {
  const ctraderConfigured = Boolean(env.CTRADER_CLIENT_ID && env.CTRADER_CLIENT_SECRET && env.CTRADER_REDIRECT_URI && env.TRADING_MASTER_KEY);
  const mt5CloudProvider = safeText(env.MT5_CLOUD_PROVIDER);
  return {
    ctrader: {
      configured: ctraderConfigured,
      status: ctraderConfigured ? 'ready' : 'submitted_or_not_configured',
      redirectUri: env.CTRADER_REDIRECT_URI || null,
    },
    mt5: {
      bridge: { configured: Boolean(env.TRADING_MASTER_KEY), requiresRunningTerminal: true },
      cloud: { configured: Boolean(mt5CloudProvider && env.TRADING_MASTER_KEY), provider: mt5CloudProvider },
    },
  };
}

function publicSource(row = {}, env = {}, requestUrl = null) {
  const providerType = row.provider_type ?? row.providerType ?? null;
  const sourceId = row.id ? String(row.id) : null;
  return {
    id: row.id,
    providerType,
    sourceFamily: row.source_family ?? row.sourceFamily ?? null,
    sourceType: row.source_type ?? row.sourceType ?? null,
    sourceInstanceId: row.source_instance_id ?? row.sourceInstanceId ?? null,
    displayName: row.display_name ?? row.displayName ?? null,
    externalIdentity: row.external_identity ?? row.externalIdentity ?? null,
    priority: Number(row.priority || 0),
    enabled: Boolean(row.is_active ?? row.enabled),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    config: sanitizeConnectionConfig(row.config || {}),
    credentialConfigured: Boolean(row.provider_secret_ciphertext ?? row.providerSecretCiphertext),
    ingressAuthenticationConfigured: Boolean(sourceId),
    ...(providerType === 'external_mtproto' && sourceId
      ? { endpointUrl: `${canonicalOrigin(env, requestUrl)}/api/v1/external/mtproto/${encodeURIComponent(sourceId)}` }
      : {}),
  };
}

function publicAccount(row = {}) {
  const safety = safeObject(row.safety_policy ?? row.safetyPolicy);
  const providerMode = row.provider_mode ?? row.providerMode ?? 'legacy';
  return {
    id: row.id,
    label: row.account_label ?? row.label ?? null,
    platform: row.platform ?? null,
    providerMode,
    accountId: row.account_id ?? row.accountId ?? null,
    serverName: row.server_name ?? row.serverName ?? null,
    environment: row.environment ?? null,
    roles: normalizeConnectionRoles(row.roles, providerMode === 'legacy' ? ['execution'] : ['source']),
    providerConfig: sanitizeConnectionConfig(row.provider_config ?? row.providerConfig ?? {}),
    active: Boolean(row.is_active ?? row.active),
    executionEnabled: Boolean(row.execution_enabled ?? row.executionEnabled),
    killSwitch: safety.killSwitch !== false,
    credentialConfigured: Boolean(row.credential_ciphertext ?? row.credentialCiphertext),
    lotSizingType: row.lot_sizing_type ?? row.lotSizingType ?? 'fixed',
    lotValue: row.lot_value ?? row.lotValue ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
}

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function defaultSupabase(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  return createClient(url, key);
}

export function buildCTraderAuthorizationUrl({ clientId, redirectUri, scope = 'trading' }) {
  if (!clientId || !redirectUri) throw new Error('CTRADER_NOT_CONFIGURED');
  const url = new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('product', 'web');
  return url.toString();
}

async function exchangeCTraderCode(code, env = {}, fetchFn = fetch) {
  const tokenUrl = new URL('https://openapi.ctrader.com/apps/token');
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('redirect_uri', env.CTRADER_REDIRECT_URI);
  tokenUrl.searchParams.set('client_id', env.CTRADER_CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', env.CTRADER_CLIENT_SECRET);
  const response = await fetchFn(tokenUrl.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('CTRADER_TOKEN_EXCHANGE_FAILED');
  const payload = await response.json();
  if (!payload?.accessToken || !payload?.refreshToken || payload?.errorCode) throw new Error('CTRADER_TOKEN_EXCHANGE_FAILED');
  return payload;
}

export function normalizeCTraderDiscoveredAccounts(items = []) {
  const byId = new Map();
  for (const item of items.flat ? items.flat() : items) {
    const id = String(item?.ctidTraderAccountId ?? '').trim();
    if (!id) continue;
    const candidate = {
      ctidTraderAccountId: id,
      isLive: Boolean(item?.isLive),
      traderLogin: item?.traderLogin == null ? null : String(item.traderLogin),
      brokerTitleShort: safeText(item?.brokerTitleShort),
    };
    const existing = byId.get(id);
    if (!existing || (!existing.brokerTitleShort && candidate.brokerTitleShort)) byId.set(id, candidate);
  }
  return [...byId.values()];
}

async function discoverOnEnvironment(environment, accessToken, env, { sessionFactory } = {}) {
  const session = sessionFactory
    ? sessionFactory(environment)
    : new CTraderJsonSession({
      endpoint: ctraderEndpoint(environment, 'json'),
      clientId: env.CTRADER_CLIENT_ID,
      clientSecret: env.CTRADER_CLIENT_SECRET,
    });
  try {
    await session.open();
    const response = await session.request(
      buildAccountsByAccessTokenMessage(accessToken, session.nextClientMsgId('accounts-by-token')),
      { successPayloadTypes: [2150] },
    );
    return response?.payload?.ctidTraderAccount || [];
  } finally {
    try { session.close(); } catch {}
  }
}

export async function discoverCTraderAccounts(accessToken, env = {}, options = {}) {
  const outcomes = await Promise.allSettled([
    discoverOnEnvironment('demo', accessToken, env, options),
    discoverOnEnvironment('live', accessToken, env, options),
  ]);
  const accounts = outcomes.filter((item) => item.status === 'fulfilled').flatMap((item) => item.value || []);
  if (!accounts.length && outcomes.every((item) => item.status === 'rejected')) throw new Error('CTRADER_ACCOUNT_DISCOVERY_FAILED');
  return normalizeCTraderDiscoveredAccounts(accounts);
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function can(authorization, permission) {
  return hasTradingPermission(authorization?.membership?.role, permission);
}

async function getSource(supabase, workspaceId, sourceId) {
  const { data, error } = await supabase.from('source_connections').select(SOURCE_SELECT).eq('workspace_id', workspaceId).eq('id', sourceId).maybeSingle();
  if (error) throw new Error('SOURCE_READ_FAILED');
  return data || null;
}

async function getAccount(supabase, workspaceId, accountId) {
  const { data, error } = await supabase.from('trade_accounts').select(ACCOUNT_SELECT).eq('workspace_id', workspaceId).eq('id', accountId).maybeSingle();
  if (error) throw new Error('ACCOUNT_READ_FAILED');
  return data || null;
}

async function handleSourceConnection(request, authorization, supabase, env, sourceId) {
  const workspaceId = String(authorization.workspace.id);
  const current = await getSource(supabase, workspaceId, sourceId);
  if (!current) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);

  if (request.method === 'GET') {
    if (!can(authorization, 'sources.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    return json({ ok: true, source: publicSource(current, env, request.url) });
  }

  if (!can(authorization, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);

  if (request.method === 'PUT') {
    const body = await readBody(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    if ('providerType' in body || 'provider_type' in body || 'sourceFamily' in body || 'source_family' in body || 'sourceType' in body || 'source_type' in body) {
      return json({ ok: false, reason: 'SOURCE_PROVIDER_IMMUTABLE' }, 400);
    }
    const update = {};
    if ('displayName' in body || 'display_name' in body) update.display_name = safeText(body.displayName ?? body.display_name);
    if ('sourceInstanceId' in body || 'source_instance_id' in body) {
      const instance = safeText(body.sourceInstanceId ?? body.source_instance_id);
      if (!instance) return json({ ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' }, 400);
      update.source_instance_id = instance;
    }
    if ('externalIdentity' in body || 'external_identity' in body) update.external_identity = safeText(body.externalIdentity ?? body.external_identity);
    if ('priority' in body) {
      const priority = Number(body.priority);
      if (!Number.isFinite(priority)) return json({ ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' }, 400);
      update.priority = priority;
    }
    if ('config' in body) update.config = sanitizeConnectionConfig(safeObject(body.config));
    if (!Object.keys(update).length) return json({ ok: false, reason: 'SOURCE_UPDATE_EMPTY' }, 400);
    const { data, error } = await supabase.from('source_connections').update(update).eq('workspace_id', workspaceId).eq('id', sourceId).select(SOURCE_SELECT).maybeSingle();
    if (error) return json({ ok: false, reason: 'SOURCE_UPDATE_FAILED' }, 503);
    return json({ ok: true, source: publicSource(data, env, request.url) });
  }

  if (request.method === 'DELETE') {
    const { error } = await supabase.from('source_connections').delete().eq('workspace_id', workspaceId).eq('id', sourceId);
    if (error) return json({ ok: false, reason: 'SOURCE_DELETE_FAILED' }, 409);
    return json({ ok: true, deleted: true, sourceId });
  }

  return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, DELETE' });
}

async function handleAccountConnection(request, authorization, supabase, accountRowId) {
  const workspaceId = String(authorization.workspace.id);
  const current = await getAccount(supabase, workspaceId, accountRowId);
  if (!current) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);

  if (request.method === 'GET') {
    if (!can(authorization, 'accounts.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    return json({ ok: true, account: publicAccount(current) });
  }

  if (!can(authorization, 'accounts.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);

  if (request.method === 'PUT') {
    const body = await readBody(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    const immutable = ['platform', 'providerMode', 'provider_mode', 'accountId', 'account_id', 'active', 'executionEnabled', 'execution_enabled', 'killSwitch'];
    if (immutable.some((key) => Object.prototype.hasOwnProperty.call(body, key))) return json({ ok: false, reason: 'ACCOUNT_IDENTITY_OR_EXECUTION_IMMUTABLE' }, 400);
    const update = {};
    if ('label' in body || 'accountLabel' in body) {
      const label = safeText(body.label ?? body.accountLabel);
      if (!label) return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
      update.account_label = label;
    }
    if ('serverName' in body || 'server_name' in body) update.server_name = safeText(body.serverName ?? body.server_name);
    if ('environment' in body) {
      const environment = safeText(body.environment);
      if (environment && !['demo', 'live'].includes(environment)) return json({ ok: false, reason: 'ACCOUNT_ENVIRONMENT_INVALID' }, 400);
      update.environment = environment;
    }
    if ('roles' in body) update.roles = normalizeConnectionRoles(body.roles, []);
    if ('providerConfig' in body || 'provider_config' in body) update.provider_config = sanitizeConnectionConfig(safeObject(body.providerConfig ?? body.provider_config));
    if ('lotValue' in body || 'lot_value' in body) {
      const lot = Number(body.lotValue ?? body.lot_value);
      if (!(lot > 0)) return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
      update.lot_value = lot;
    }
    if (!Object.keys(update).length) return json({ ok: false, reason: 'ACCOUNT_UPDATE_EMPTY' }, 400);
    const { data, error } = await supabase.from('trade_accounts').update(update).eq('workspace_id', workspaceId).eq('id', accountRowId).select(ACCOUNT_SELECT).maybeSingle();
    if (error) return json({ ok: false, reason: 'ACCOUNT_UPDATE_FAILED' }, 503);
    return json({ ok: true, account: publicAccount(data) });
  }

  if (request.method === 'DELETE') {
    const { error } = await supabase.from('trade_accounts').delete().eq('workspace_id', workspaceId).eq('id', accountRowId);
    if (error) return json({ ok: false, reason: 'ACCOUNT_DELETE_FAILED' }, 409);
    return json({ ok: true, deleted: true, accountId: accountRowId });
  }

  return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, PUT, DELETE' });
}

async function createMt5Connection(request, authorization, supabase, env) {
  if (!can(authorization, 'accounts.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  if (!env.TRADING_MASTER_KEY) return json({ ok: false, reason: 'ACCOUNT_ENCRYPTION_NOT_CONFIGURED' }, 503);
  const body = await readBody(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const mode = safeText(body.providerMode ?? body.mode);
  if (!['mt5_bridge', 'mt5_cloud'].includes(mode)) return json({ ok: false, reason: 'MT5_MODE_UNSUPPORTED' }, 400);
  const label = safeText(body.label);
  if (!label) return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
  const roles = normalizeConnectionRoles(body.roles, ['source']);
  const workspaceId = String(authorization.workspace.id);

  let accountId;
  let serverName = safeText(body.serverName ?? body.server);
  let credentialCiphertext;
  let providerConfig;
  let oneTimeBridgeSecret = null;
  let bridgeEndpoint = null;

  if (mode === 'mt5_bridge') {
    oneTimeBridgeSecret = randomToken(32);
    accountId = `pending:${randomToken(12)}`;
    bridgeEndpoint = `${canonicalOrigin(env, request.url)}/api/v1/external/mt5/bridge`;
    credentialCiphertext = await encryptConnectionCredentials('mt5', { bridgeUrl: bridgeEndpoint, bridgeSecret: oneTimeBridgeSecret }, env.TRADING_MASTER_KEY);
    providerConfig = { status: 'awaiting_terminal', requiresRunningTerminal: true };
  } else {
    const provider = safeText(env.MT5_CLOUD_PROVIDER);
    if (!provider) return json({ ok: false, reason: 'MT5_CLOUD_PROVIDER_NOT_CONFIGURED' }, 503);
    const login = safeText(body.login ?? body.accountId);
    const password = safeText(body.password);
    if (!login || !serverName || !password) return json({ ok: false, reason: 'MT5_CLOUD_CREDENTIALS_REQUIRED' }, 400);
    accountId = login;
    credentialCiphertext = await encryptConnectionCredentials('mt5_cloud', { login, server: serverName, password }, env.TRADING_MASTER_KEY);
    providerConfig = { status: 'configured', provider };
  }

  const row = {
    workspace_id: workspaceId,
    account_label: label,
    platform: 'mt5',
    account_id: accountId,
    server_name: serverName,
    lot_sizing_type: 'fixed',
    lot_value: Number(body.lotValue) > 0 ? Number(body.lotValue) : 0.01,
    is_active: false,
    execution_enabled: false,
    safety_policy: { killSwitch: true },
    fast_entry_policy: {},
    entry_zone_policy: {},
    credential_ciphertext: credentialCiphertext,
    provider_mode: mode,
    environment: ['demo', 'live'].includes(body.environment) ? body.environment : null,
    roles,
    provider_config: providerConfig,
  };
  const { data, error } = await supabase.from('trade_accounts').insert(row).select(ACCOUNT_SELECT).maybeSingle();
  if (error || !data) return json({ ok: false, reason: 'ACCOUNT_CREATE_FAILED' }, 503);
  return json({
    ok: true,
    account: publicAccount(data),
    ...(mode === 'mt5_bridge' ? { bridgeEndpoint, oneTimeBridgeSecret, bridgeAccountId: data.id } : {}),
  }, 201);
}

async function startCTraderOAuth(request, authorization, supabase, env) {
  if (!can(authorization, 'accounts.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  if (!connectionReadiness(env).ctrader.configured) return json({ ok: false, reason: 'CTRADER_NOT_CONFIGURED' }, 503);
  const body = await readBody(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const state = randomToken(32);
  const roles = normalizeConnectionRoles(body.roles, ['source']);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase.from('trading_ctrader_oauth_states').insert({
    state_token: state,
    workspace_id: String(authorization.workspace.id),
    subject: String(authorization.auth.subject),
    requested_roles: roles,
    expires_at: expiresAt,
  });
  if (error) return json({ ok: false, reason: 'CTRADER_OAUTH_STATE_CREATE_FAILED' }, 503);
  return json({
    ok: true,
    state,
    expiresAt,
    authorizationUrl: buildCTraderAuthorizationUrl({ clientId: env.CTRADER_CLIENT_ID, redirectUri: env.CTRADER_REDIRECT_URI, scope: 'trading' }),
  });
}

async function completeCTraderOAuth(request, authorization, supabase, env, { fetchFn = fetch, discoverAccounts = discoverCTraderAccounts } = {}) {
  if (!can(authorization, 'accounts.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  if (!connectionReadiness(env).ctrader.configured) return json({ ok: false, reason: 'CTRADER_NOT_CONFIGURED' }, 503);
  const body = await readBody(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const state = safeText(body.state);
  const code = safeText(body.code);
  if (!state || !code) return json({ ok: false, reason: 'CTRADER_OAUTH_CODE_AND_STATE_REQUIRED' }, 400);
  const workspaceId = String(authorization.workspace.id);
  const subject = String(authorization.auth.subject);
  const now = new Date().toISOString();
  const { data: stateRow, error: stateError } = await supabase
    .from('trading_ctrader_oauth_states')
    .select('*')
    .eq('state_token', state)
    .eq('workspace_id', workspaceId)
    .eq('subject', subject)
    .is('consumed_at', null)
    .gt('expires_at', now)
    .maybeSingle();
  if (stateError) return json({ ok: false, reason: 'CTRADER_OAUTH_STATE_READ_FAILED' }, 503);
  if (!stateRow) return json({ ok: false, reason: 'CTRADER_OAUTH_STATE_INVALID_OR_EXPIRED' }, 401);
  const { data: consumed, error: consumeError } = await supabase
    .from('trading_ctrader_oauth_states')
    .update({ consumed_at: now })
    .eq('id', stateRow.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();
  if (consumeError || !consumed) return json({ ok: false, reason: 'CTRADER_OAUTH_STATE_ALREADY_USED' }, 409);

  let token;
  let discovered;
  try {
    token = await exchangeCTraderCode(code, env, fetchFn);
    discovered = await discoverAccounts(token.accessToken, env);
  } catch (error) {
    return json({ ok: false, reason: error?.message || 'CTRADER_OAUTH_COMPLETE_FAILED' }, 502);
  }
  if (!discovered.length) return json({ ok: false, reason: 'CTRADER_NO_AUTHORIZED_ACCOUNTS' }, 422);

  const credentialCiphertext = await encryptConnectionCredentials('ctrader', {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
  }, env.TRADING_MASTER_KEY);
  const roles = normalizeConnectionRoles(stateRow.requested_roles, ['source']);
  const connectedAt = new Date().toISOString();
  const rows = discovered.map((account) => ({
    workspace_id: workspaceId,
    account_label: account.brokerTitleShort ? `${account.brokerTitleShort} ${account.traderLogin || account.ctidTraderAccountId}` : `cTrader ${account.traderLogin || account.ctidTraderAccountId}`,
    platform: 'ctrader',
    account_id: String(account.ctidTraderAccountId),
    server_name: null,
    lot_sizing_type: 'fixed',
    lot_value: 0.01,
    is_active: false,
    execution_enabled: false,
    safety_policy: { killSwitch: true },
    fast_entry_policy: {},
    entry_zone_policy: {},
    credential_ciphertext: credentialCiphertext,
    provider_mode: 'ctrader_oauth',
    environment: account.isLive ? 'live' : 'demo',
    roles,
    provider_config: {
      traderLogin: account.traderLogin,
      brokerTitleShort: account.brokerTitleShort,
      connectedAt,
      tokenExpiresInSeconds: Number(token.expiresIn || 0) || null,
    },
  }));
  const { data, error } = await supabase.from('trade_accounts').upsert(rows, {
    onConflict: 'workspace_id,platform,provider_mode,account_id',
  }).select(ACCOUNT_SELECT);
  if (error) return json({ ok: false, reason: 'CTRADER_ACCOUNT_PERSIST_FAILED' }, 503);
  return json({ ok: true, accounts: (data || []).map(publicAccount), authorizedCount: (data || []).length });
}

export async function handleV1AdminConnectionsRequest(request, env = {}, {
  supabaseFactory = defaultSupabase,
  authorizeFn = authorizeV1AdminRequest,
  fetchFn = fetch,
  discoverAccounts = discoverCTraderAccounts,
} = {}) {
  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503); }
  const authorization = await authorizeFn(request, env, { supabase });
  if (!authorization?.ok) return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);

  const url = new URL(request.url);
  const base = '/api/v1/admin/connections';
  if (url.pathname === base) {
    if (request.method !== 'GET') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
    return json({ ok: true, readiness: connectionReadiness(env) });
  }

  const sourceMatch = url.pathname.match(/^\/api\/v1\/admin\/connections\/sources\/([^/]+)$/);
  if (sourceMatch) {
    let id;
    try { id = decodeURIComponent(sourceMatch[1]); } catch { return json({ ok: false, reason: 'SOURCE_ID_INVALID' }, 400); }
    return handleSourceConnection(request, authorization, supabase, env, id);
  }

  if (url.pathname === `${base}/accounts`) {
    if (request.method === 'GET') {
      if (!can(authorization, 'accounts.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      const { data, error } = await supabase.from('trade_accounts').select(ACCOUNT_SELECT).eq('workspace_id', String(authorization.workspace.id)).order('created_at', { ascending: true });
      if (error) return json({ ok: false, reason: 'ACCOUNT_LIST_FAILED' }, 503);
      return json({ ok: true, accounts: (data || []).map(publicAccount), readiness: connectionReadiness(env) });
    }
    if (request.method === 'POST') return createMt5Connection(request, authorization, supabase, env);
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  const accountMatch = url.pathname.match(/^\/api\/v1\/admin\/connections\/accounts\/([^/]+)$/);
  if (accountMatch) {
    let id;
    try { id = decodeURIComponent(accountMatch[1]); } catch { return json({ ok: false, reason: 'ACCOUNT_ID_INVALID' }, 400); }
    return handleAccountConnection(request, authorization, supabase, id);
  }

  if (url.pathname === `${base}/ctrader/start` && request.method === 'POST') {
    return startCTraderOAuth(request, authorization, supabase, env);
  }
  if (url.pathname === `${base}/ctrader/complete` && request.method === 'POST') {
    return completeCTraderOAuth(request, authorization, supabase, env, { fetchFn, discoverAccounts });
  }

  return json({ ok: false, reason: 'ADMIN_CONNECTION_ROUTE_NOT_FOUND' }, 404);
}
