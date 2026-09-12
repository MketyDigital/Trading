import { hasTradingPermission } from '../security/trading_permissions.js';
import { encryptConnectionCredentials, validateConnectionCredentials } from '../security/connection_credentials.js';
import { createTradingRuntimeControlStore } from '../persistence/supabase_runtime_control_store.js';

const ACCOUNT_SELECT = [
  'id', 'workspace_id', 'account_label', 'platform', 'account_id', 'server_name', 'provider_mode', 'environment',
  'lot_sizing_type', 'lot_value', 'is_active', 'execution_enabled', 'live_execution_enabled', 'safety_policy',
  'fast_entry_policy', 'entry_zone_policy', 'credential_ciphertext', 'created_at',
].join(',');
const SUPPORTED_BROKER_PLATFORMS = new Set(['mt5', 'ctrader']);

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders } });
}
function publicAccount(account = {}) {
  const credentialConfigured = Boolean(account.credential_ciphertext ?? account.credentialCiphertext ?? account.credentialConfigured ?? account.credentialsConfigured);
  return {
    id: account.id, label: account.account_label ?? account.label ?? null, platform: account.platform ?? null,
    providerMode: account.provider_mode ?? account.providerMode ?? null, environment: account.environment ?? null,
    accountId: account.account_id ?? account.accountId ?? null, serverName: account.server_name ?? account.serverName ?? null,
    active: Boolean(account.is_active ?? account.active), executionEnabled: Boolean(account.execution_enabled ?? account.executionEnabled),
    liveExecutionEnabled: Boolean(account.live_execution_enabled ?? account.liveExecutionEnabled),
    killSwitch: Boolean((account.safety_policy ?? account.safetyPolicy)?.killSwitch), lotSizingType: account.lot_sizing_type ?? account.lotSizingType ?? null,
    lotValue: account.lot_value ?? account.lotValue ?? null, fastEntryPolicy: account.fast_entry_policy ?? account.fastEntryPolicy ?? null,
    entryZonePolicy: account.entry_zone_policy ?? account.entryZonePolicy ?? null, credentialConfigured, createdAt: account.created_at ?? account.createdAt ?? null,
  };
}
async function readJson(request) { try { const body = await request.json(); return body && typeof body === 'object' && !Array.isArray(body) ? body : {}; } catch { return null; } }
function can(authorization, permission) { return hasTradingPermission(authorization?.membership?.role, permission); }
function requiredText(value) { const out = String(value ?? '').trim(); return out || null; }
function optionalNumber(value) { if (value === undefined || value === null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function safeObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function parseEnvironment(value) { const env = requiredText(value)?.toLowerCase() ?? null; return env && ['demo', 'live'].includes(env) ? env : null; }

function parseAccountCreation(body) {
  const platform = requiredText(body.platform)?.toLowerCase() ?? null;
  const label = requiredText(body.label ?? body.accountLabel ?? body.account_label);
  const accountId = requiredText(body.accountId ?? body.account_id);
  const serverName = requiredText(body.serverName ?? body.server_name);
  const lotSizingType = requiredText(body.lotSizingType ?? body.lot_sizing_type) ?? 'fixed';
  const lotValue = optionalNumber(body.lotValue ?? body.lot_value);
  const requestedEnvironment = requiredText(body.environment)?.toLowerCase() ?? null;
  if (!platform || !SUPPORTED_BROKER_PLATFORMS.has(platform)) return { ok: false, reason: 'ACCOUNT_PLATFORM_UNSUPPORTED' };
  if (!label || !accountId || lotValue === undefined) return { ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' };
  if (requestedEnvironment && !['demo', 'live'].includes(requestedEnvironment)) return { ok: false, reason: 'ACCOUNT_ENVIRONMENT_INVALID' };
  try { validateConnectionCredentials(platform, body.credentials); } catch { return { ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' }; }
  return { ok: true, credentials: body.credentials, input: {
    label, platform, accountId, serverName, environment: requestedEnvironment, lotSizingType, lotValue,
    active: false, executionEnabled: false, liveExecutionEnabled: false,
    safetyPolicy: { ...safeObject(body.safetyPolicy ?? body.safety_policy), killSwitch: true },
    fastEntryPolicy: safeObject(body.fastEntryPolicy ?? body.fast_entry_policy), entryZonePolicy: safeObject(body.entryZonePolicy ?? body.entry_zone_policy),
  } };
}

export function createAdminAccountStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  async function getAccount(workspaceId, accountId) {
    if (!workspaceId || !accountId) return null;
    const { data, error } = await supabase.from('trade_accounts').select(ACCOUNT_SELECT).eq('workspace_id', String(workspaceId)).eq('id', String(accountId)).maybeSingle();
    if (error) throw new Error('ACCOUNT_READ_FAILED');
    return data || null;
  }
  async function updateOne(workspaceId, accountId, patch, errorCode) {
    const { data, error } = await supabase.from('trade_accounts').update(patch).eq('workspace_id', String(workspaceId)).eq('id', String(accountId)).select(ACCOUNT_SELECT).maybeSingle();
    if (error) throw new Error(errorCode);
    return data || null;
  }
  return {
    async listAccounts(workspaceId) {
      if (!workspaceId) return [];
      const { data, error } = await supabase.from('trade_accounts').select(ACCOUNT_SELECT).eq('workspace_id', String(workspaceId)).order('created_at', { ascending: true });
      if (error) throw new Error('ACCOUNT_LIST_FAILED');
      return data || [];
    },
    getAccount,
    async createAccount(workspaceId, input, credentialCiphertext = input?.credentialCiphertext) {
      if (!workspaceId || !input?.label || !input?.platform || !input?.accountId || !credentialCiphertext) throw new Error('ACCOUNT_CREATE_FAILED');
      const insert = {
        workspace_id: String(workspaceId), account_label: String(input.label), platform: String(input.platform), account_id: String(input.accountId),
        server_name: input.serverName ?? null, environment: parseEnvironment(input.environment), lot_sizing_type: input.lotSizingType ?? 'fixed', lot_value: input.lotValue ?? null,
        is_active: false, execution_enabled: false, live_execution_enabled: false,
        safety_policy: { ...safeObject(input.safetyPolicy), killSwitch: true }, fast_entry_policy: safeObject(input.fastEntryPolicy), entry_zone_policy: safeObject(input.entryZonePolicy),
        credential_ciphertext: String(credentialCiphertext),
      };
      const { data, error } = await supabase.from('trade_accounts').insert(insert).select(ACCOUNT_SELECT).maybeSingle();
      if (error || !data) throw new Error('ACCOUNT_CREATE_FAILED');
      return data;
    },
    async replaceAccountCredentials(workspaceId, accountId, credentialCiphertext) {
      if (!workspaceId || !accountId || !credentialCiphertext) throw new Error('ACCOUNT_CREDENTIAL_REPLACE_FAILED');
      return updateOne(workspaceId, accountId, { credential_ciphertext: String(credentialCiphertext) }, 'ACCOUNT_CREDENTIAL_REPLACE_FAILED');
    },
    async setActive(workspaceId, accountId, value) {
      return updateOne(workspaceId, accountId, value ? { is_active: true } : { is_active: false, execution_enabled: false, live_execution_enabled: false }, 'ACCOUNT_ACTIVE_UPDATE_FAILED');
    },
    async setExecutionEnabled(workspaceId, accountId, value) { return updateOne(workspaceId, accountId, { execution_enabled: Boolean(value) }, 'ACCOUNT_EXECUTION_UPDATE_FAILED'); },
    async setLiveExecutionEnabled(workspaceId, accountId, value) {
      const account = await getAccount(workspaceId, accountId);
      if (!account) return null;
      if (value === true && String(account.environment || '').toLowerCase() !== 'live') {
        const error = new Error('LIVE_EXECUTION_REQUIRES_LIVE_ACCOUNT'); error.code = 'LIVE_EXECUTION_REQUIRES_LIVE_ACCOUNT'; throw error;
      }
      return updateOne(workspaceId, accountId, { live_execution_enabled: Boolean(value) }, 'ACCOUNT_LIVE_EXECUTION_UPDATE_FAILED');
    },
    async setKillSwitch(workspaceId, accountId, value) {
      const account = await getAccount(workspaceId, accountId); if (!account) return null;
      const safetyPolicy = { ...(account.safety_policy && typeof account.safety_policy === 'object' ? account.safety_policy : {}), killSwitch: Boolean(value) };
      return updateOne(workspaceId, accountId, { safety_policy: safetyPolicy }, 'ACCOUNT_KILL_SWITCH_UPDATE_FAILED');
    },
  };
}

async function runtimeSummary(runtimeStore) {
  if (!runtimeStore) return null;
  try {
    const [trading, broker, live] = await Promise.all([runtimeStore.getTradingAccessEnabled(), runtimeStore.getBrokerExecutionEnabled(), runtimeStore.getLiveBrokerExecutionEnabled()]);
    if (!trading?.ok || !broker?.ok || !live?.ok) return null;
    return { tradingAccessEnabled: trading.enabled === true, brokerExecutionEnabled: broker.enabled === true, liveBrokerExecutionEnabled: live.enabled === true };
  } catch { return null; }
}

export async function handleAuthorizedV1AdminAccountsRequest(request, authorization, { accountStore, env = {}, encryptCredentials = encryptConnectionCredentials, runtimeStore = null } = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!accountStore) return json({ ok: false, reason: 'ACCOUNT_STORE_UNAVAILABLE' }, 503);
  const url = new URL(request.url); const prefix = '/api/v1/admin/accounts';
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return json({ ok: false, reason: 'ADMIN_ACCOUNT_ROUTE_NOT_FOUND' }, 404);
  const controls = await runtimeSummary(runtimeStore);

  if (url.pathname === prefix) {
    if (request.method === 'GET') {
      if (!can(authorization, 'accounts.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      try { return json({ ok: true, workspaceId, ...(controls ? { runtimeControls: controls } : {}), accounts: (await accountStore.listAccounts(workspaceId)).map(publicAccount) }); }
      catch { return json({ ok: false, reason: 'ACCOUNT_LIST_FAILED' }, 503); }
    }
    if (request.method === 'POST') {
      if (!can(authorization, 'accounts.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      const body = await readJson(request); if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = parseAccountCreation(body); if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      if (!env?.TRADING_MASTER_KEY) return json({ ok: false, reason: 'ACCOUNT_ENCRYPTION_NOT_CONFIGURED' }, 503);
      let credentialCiphertext;
      try { credentialCiphertext = await encryptCredentials(parsed.input.platform, parsed.credentials, env.TRADING_MASTER_KEY); }
      catch { return json({ ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' }, 400); }
      try {
        const account = await accountStore.createAccount(workspaceId, { ...parsed.input, credentialCiphertext }, credentialCiphertext);
        if (!account) return json({ ok: false, reason: 'ACCOUNT_CREATE_FAILED' }, 503);
        return json({ ok: true, workspaceId, ...(controls ? { runtimeControls: controls } : {}), account: publicAccount({ ...account, credentialConfigured: true }) }, 201);
      } catch { return json({ ok: false, reason: 'ACCOUNT_CREATE_FAILED' }, 503); }
    }
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  const rest = url.pathname.slice(prefix.length + 1).split('/').filter(Boolean); const accountId = rest[0] ? decodeURIComponent(rest[0]) : ''; const action = rest[1] ?? null;
  if (!accountId || !action || rest.length !== 2) return json({ ok: false, reason: 'ADMIN_ACCOUNT_ROUTE_NOT_FOUND' }, 404);

  if (action === 'credentials') {
    if (request.method !== 'PUT') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'PUT' });
    if (!can(authorization, 'accounts.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    if (!env?.TRADING_MASTER_KEY) return json({ ok: false, reason: 'ACCOUNT_ENCRYPTION_NOT_CONFIGURED' }, 503);
    let existing; try { existing = await accountStore.getAccount(workspaceId, accountId); } catch { return json({ ok: false, reason: 'ACCOUNT_READ_FAILED' }, 503); }
    if (!existing) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
    const platform = requiredText(existing.platform)?.toLowerCase() ?? null;
    if (!platform || !SUPPORTED_BROKER_PLATFORMS.has(platform)) return json({ ok: false, reason: 'ACCOUNT_PLATFORM_UNSUPPORTED' }, 400);
    const body = await readJson(request); if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    try { validateConnectionCredentials(platform, body.credentials); } catch { return json({ ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' }, 400); }
    let credentialCiphertext; try { credentialCiphertext = await encryptCredentials(platform, body.credentials, env.TRADING_MASTER_KEY); } catch { return json({ ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' }, 400); }
    try {
      const account = await accountStore.replaceAccountCredentials(workspaceId, accountId, credentialCiphertext); if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, ...(controls ? { runtimeControls: controls } : {}), account: publicAccount({ ...account, credentialConfigured: true }) });
    } catch { return json({ ok: false, reason: 'ACCOUNT_CREDENTIAL_REPLACE_FAILED' }, 503); }
  }

  if (!['POST', 'PATCH'].includes(request.method)) return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST, PATCH' });
  if (!can(authorization, 'accounts.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  const body = await readJson(request); if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const value = body.enabled ?? body.active ?? body.killSwitch;
  if (typeof value !== 'boolean') return json({ ok: false, reason: 'ENABLED_BOOLEAN_REQUIRED' }, 400);
  try {
    let account;
    if (action === 'active') account = await accountStore.setActive(workspaceId, accountId, value);
    else if (action === 'execution') account = await accountStore.setExecutionEnabled(workspaceId, accountId, value);
    else if (action === 'live-execution') account = await accountStore.setLiveExecutionEnabled(workspaceId, accountId, value);
    else if (action === 'kill-switch') account = await accountStore.setKillSwitch(workspaceId, accountId, value);
    else return json({ ok: false, reason: 'ADMIN_ACCOUNT_ROUTE_NOT_FOUND' }, 404);
    if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
    return json({ ok: true, workspaceId, ...(controls ? { runtimeControls: controls } : {}), account: publicAccount(account) });
  } catch (error) {
    if (error?.code === 'LIVE_EXECUTION_REQUIRES_LIVE_ACCOUNT') return json({ ok: false, reason: error.code }, 409);
    return json({ ok: false, reason: action === 'live-execution' ? 'ACCOUNT_LIVE_EXECUTION_UPDATE_FAILED' : 'ACCOUNT_CONTROL_UPDATE_FAILED' }, 503);
  }
}

export async function handleV1AdminAccountsRequest(request, authorization, { supabase, env = {}, accountStore = null, encryptCredentials = encryptConnectionCredentials } = {}) {
  const store = accountStore || createAdminAccountStore(supabase);
  const runtimeStore = supabase?.from ? createTradingRuntimeControlStore(supabase) : null;
  return handleAuthorizedV1AdminAccountsRequest(request, authorization, { accountStore: store, env, encryptCredentials, runtimeStore });
}
