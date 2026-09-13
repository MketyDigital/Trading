import { createClient } from '@supabase/supabase-js';
import { authorizeV1AdminRequest } from './v1_admin.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import {
  decryptConnectionCredentials,
  encryptConnectionCredentials,
} from '../security/connection_credentials.js';
import { handleV1AdminConnectionsRequest as baseHandler } from './v1_admin_connections_relay.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function requiredText(value, reason) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(reason);
  return text;
}

async function defaultSupabase(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  return createClient(url, key);
}

async function readJson(request) {
  try {
    const body = await request.clone().json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function decorate(account = {}, row = {}) {
  const safety = safeObject(row.safety_policy);
  const executionEnabled = Boolean(row.execution_enabled ?? account.executionEnabled);
  const killSwitch = safety.killSwitch !== false;
  return {
    ...account,
    executionEnabled,
    killSwitch,
    tradingEnabled: executionEnabled && !killSwitch,
    liveExecutionEnabled: Boolean(row.live_execution_enabled),
  };
}

export function buildCompleteCTraderCredentials(existing = {}, env = {}) {
  return {
    clientId: requiredText(env.CTRADER_CLIENT_ID, 'CTRADER_CLIENT_ID_REQUIRED'),
    clientSecret: requiredText(env.CTRADER_CLIENT_SECRET, 'CTRADER_CLIENT_SECRET_REQUIRED'),
    accessToken: requiredText(existing.accessToken, 'CTRADER_ACCESS_TOKEN_REQUIRED'),
    refreshToken: requiredText(existing.refreshToken, 'CTRADER_REFRESH_TOKEN_REQUIRED'),
  };
}

async function authorize(request, env, dependencies, supabase) {
  const authorizeFn = dependencies.authorizeFn || authorizeV1AdminRequest;
  return authorizeFn(request, env, { supabase });
}

async function readControlRows(supabase, workspaceId, accountId = null) {
  let query = supabase
    .from('trade_accounts')
    .select('id,workspace_id,environment,execution_enabled,live_execution_enabled,safety_policy')
    .eq('workspace_id', String(workspaceId));
  if (accountId) {
    const { data, error } = await query.eq('id', String(accountId)).maybeSingle();
    if (error) throw new Error('ACCOUNT_READ_FAILED');
    return data ? [data] : [];
  }
  const { data, error } = await query;
  if (error) throw new Error('ACCOUNT_LIST_FAILED');
  return Array.isArray(data) ? data : [];
}

async function repairCTraderOAuthCredentials(supabase, workspaceId, env, accountIds = []) {
  const masterKey = requiredText(env.TRADING_MASTER_KEY, 'TRADING_MASTER_KEY_REQUIRED');
  requiredText(env.CTRADER_CLIENT_ID, 'CTRADER_CLIENT_ID_REQUIRED');
  requiredText(env.CTRADER_CLIENT_SECRET, 'CTRADER_CLIENT_SECRET_REQUIRED');

  let query = supabase
    .from('trade_accounts')
    .select('id,credential_ciphertext,platform,provider_mode')
    .eq('workspace_id', String(workspaceId))
    .eq('platform', 'ctrader')
    .eq('provider_mode', 'ctrader_oauth');
  if (Array.isArray(accountIds) && accountIds.length && typeof query.in === 'function') {
    query = query.in('id', accountIds.map(String));
  }
  const { data, error } = await query;
  if (error) throw new Error('CTRADER_CREDENTIAL_REPAIR_READ_FAILED');

  let repaired = 0;
  for (const row of Array.isArray(data) ? data : []) {
    if (!row?.id || !row.credential_ciphertext) continue;
    const existing = await decryptConnectionCredentials('ctrader', row.credential_ciphertext, masterKey);
    if (existing.clientId && existing.clientSecret) continue;
    const credentialCiphertext = await encryptConnectionCredentials(
      'ctrader',
      buildCompleteCTraderCredentials(existing, env),
      masterKey,
    );
    const { error: updateError } = await supabase
      .from('trade_accounts')
      .update({ credential_ciphertext: credentialCiphertext })
      .eq('workspace_id', String(workspaceId))
      .eq('id', String(row.id));
    if (updateError) throw new Error('CTRADER_CREDENTIAL_REPAIR_UPDATE_FAILED');
    repaired += 1;
  }
  return repaired;
}

async function handleSimplifiedUpdate(request, env, dependencies, accountId, body) {
  let supabase;
  try {
    const factory = dependencies.supabaseFactory || defaultSupabase;
    supabase = await factory(env);
  } catch {
    return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503);
  }

  const authorization = await authorize(request, env, dependencies, supabase);
  if (!authorization?.ok) {
    return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);
  }
  if (!hasTradingPermission(authorization?.membership?.role, 'accounts.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }

  const rows = await readControlRows(supabase, authorization.workspace.id, accountId);
  const current = rows[0];
  if (!current) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);

  const hasTrading = Object.prototype.hasOwnProperty.call(body, 'tradingEnabled');
  const hasLive = Object.prototype.hasOwnProperty.call(body, 'allowLiveExecution');
  if (hasTrading && typeof body.tradingEnabled !== 'boolean') {
    return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
  }
  if (hasLive && typeof body.allowLiveExecution !== 'boolean') {
    return json({ ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' }, 400);
  }

  const environment = String(current.environment || '').trim().toLowerCase();
  if (hasLive && environment !== 'live') {
    return json({ ok: false, reason: 'ACCOUNT_LIVE_EXECUTION_NOT_APPLICABLE' }, 400);
  }

  const update = {};
  if (hasTrading) {
    const enabled = body.tradingEnabled === true;
    update.execution_enabled = enabled;
    update.safety_policy = { ...safeObject(current.safety_policy), killSwitch: !enabled };
    if (environment === 'demo' || (!enabled && environment === 'live')) {
      update.live_execution_enabled = false;
    }
  }
  if (hasLive) update.live_execution_enabled = body.allowLiveExecution === true;

  const { data, error } = await supabase
    .from('trade_accounts')
    .update(update)
    .eq('workspace_id', String(authorization.workspace.id))
    .eq('id', String(accountId))
    .select('id,workspace_id,environment,execution_enabled,live_execution_enabled,safety_policy')
    .maybeSingle();
  if (error || !data) return json({ ok: false, reason: 'ACCOUNT_UPDATE_FAILED' }, 503);

  return json({
    ok: true,
    account: decorate({ id: data.id, environment: data.environment }, data),
  });
}

async function enrichReadResponse(response, request, env, dependencies, accountId = null) {
  if (!response?.ok) return response;
  let payload;
  try { payload = await response.clone().json(); } catch { return response; }
  if (!payload?.ok || (!payload.account && !Array.isArray(payload.accounts))) return response;

  try {
    const factory = dependencies.supabaseFactory || defaultSupabase;
    const supabase = await factory(env);
    const authorization = await authorize(request, env, dependencies, supabase);
    if (!authorization?.ok) return response;
    try {
      await repairCTraderOAuthCredentials(
        supabase,
        authorization.workspace.id,
        env,
        accountId ? [accountId] : [],
      );
    } catch {
      // Compatibility repair must never make Connections unreadable.
    }
    const rows = await readControlRows(supabase, authorization.workspace.id, accountId);
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    if (payload.account) {
      const row = byId.get(String(payload.account.id));
      if (row) payload.account = decorate(payload.account, row);
    }
    if (Array.isArray(payload.accounts)) {
      payload.accounts = payload.accounts.map((account) => {
        const row = byId.get(String(account.id));
        return row ? decorate(account, row) : account;
      });
    }
    return json(payload, response.status);
  } catch {
    return response;
  }
}

async function finalizeCTraderOAuthResponse(response, request, env, dependencies) {
  if (!response?.ok) return response;
  let payload;
  try { payload = await response.clone().json(); } catch { return response; }
  const accountIds = Array.isArray(payload?.accounts)
    ? payload.accounts.map((account) => account?.id).filter(Boolean).map(String)
    : [];
  if (!accountIds.length) return response;

  try {
    const factory = dependencies.supabaseFactory || defaultSupabase;
    const supabase = await factory(env);
    const authorization = await authorize(request, env, dependencies, supabase);
    if (!authorization?.ok) return response;
    await repairCTraderOAuthCredentials(supabase, authorization.workspace.id, env, accountIds);
    return response;
  } catch {
    return json({ ok: false, reason: 'CTRADER_CREDENTIAL_ENVELOPE_REPAIR_FAILED' }, 503);
  }
}

export async function handleV1AdminConnectionsRequest(request, env = {}, dependencies = {}) {
  const url = new URL(request.url);
  const accountMatch = url.pathname.match(/^\/api\/v1\/admin\/connections\/accounts\/([^/]+)$/);

  if (request.method === 'PUT' && accountMatch) {
    let accountId;
    try { accountId = decodeURIComponent(accountMatch[1]); } catch {
      return json({ ok: false, reason: 'ACCOUNT_ID_INVALID' }, 400);
    }
    const body = await readJson(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    const hasTrading = Object.prototype.hasOwnProperty.call(body, 'tradingEnabled');
    const hasLive = Object.prototype.hasOwnProperty.call(body, 'allowLiveExecution');
    if (hasTrading || hasLive) {
      const keys = Object.keys(body);
      if (keys.some((key) => key !== 'tradingEnabled' && key !== 'allowLiveExecution')) {
        return json({ ok: false, reason: 'ACCOUNT_CONTROL_UPDATE_MUST_BE_SEPARATE' }, 400);
      }
      return handleSimplifiedUpdate(request, env, dependencies, accountId, body);
    }
  }

  const response = await baseHandler(request, env, dependencies);
  if (request.method === 'POST' && url.pathname === '/api/v1/admin/connections/ctrader/complete') {
    return finalizeCTraderOAuthResponse(response, request, env, dependencies);
  }
  if (request.method !== 'GET') return response;
  if (url.pathname === '/api/v1/admin/connections/accounts') {
    return enrichReadResponse(response, request, env, dependencies);
  }
  if (accountMatch) {
    let accountId;
    try { accountId = decodeURIComponent(accountMatch[1]); } catch { return response; }
    return enrichReadResponse(response, request, env, dependencies, accountId);
  }
  return response;
}
