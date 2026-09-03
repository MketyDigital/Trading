import { hasTradingPermission } from '../security/trading_permissions.js';

const ACCOUNT_SELECT = [
  'id', 'workspace_id', 'account_label', 'platform', 'account_id', 'server_name',
  'lot_sizing_type', 'lot_value', 'is_active', 'execution_enabled', 'safety_policy',
  'fast_entry_policy', 'entry_zone_policy', 'created_at',
].join(',');

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function masterBrokerExecutionEnabled(env = {}) {
  return env.BROKER_EXECUTION_ENABLED === true || String(env.BROKER_EXECUTION_ENABLED ?? '').toLowerCase() === 'true';
}

function publicAccount(account = {}) {
  return {
    id: account.id,
    label: account.account_label ?? null,
    platform: account.platform ?? null,
    accountId: account.account_id ?? null,
    serverName: account.server_name ?? null,
    active: Boolean(account.is_active),
    executionEnabled: Boolean(account.execution_enabled),
    killSwitch: Boolean(account.safety_policy?.killSwitch),
    lotSizingType: account.lot_sizing_type ?? null,
    lotValue: account.lot_value ?? null,
    fastEntryPolicy: account.fast_entry_policy ?? null,
    entryZonePolicy: account.entry_zone_policy ?? null,
    createdAt: account.created_at ?? null,
  };
}

async function readJson(request) {
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

export function createAdminAccountStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  async function getAccount(workspaceId, accountId) {
    if (!workspaceId || !accountId) return null;
    const { data, error } = await supabase
      .from('trade_accounts')
      .select(ACCOUNT_SELECT)
      .eq('workspace_id', String(workspaceId))
      .eq('id', String(accountId))
      .maybeSingle();
    if (error) throw new Error('ACCOUNT_READ_FAILED');
    return data || null;
  }

  return {
    async listAccounts(workspaceId) {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from('trade_accounts')
        .select(ACCOUNT_SELECT)
        .eq('workspace_id', String(workspaceId))
        .order('created_at', { ascending: true });
      if (error) throw new Error('ACCOUNT_LIST_FAILED');
      return data || [];
    },

    getAccount,

    async setExecutionEnabled(workspaceId, accountId, enabled) {
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({ execution_enabled: Boolean(enabled) })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_EXECUTION_UPDATE_FAILED');
      return data || null;
    },

    async setKillSwitch(workspaceId, accountId, enabled) {
      const account = await getAccount(workspaceId, accountId);
      if (!account) return null;
      const safetyPolicy = {
        ...(account.safety_policy && typeof account.safety_policy === 'object' ? account.safety_policy : {}),
        killSwitch: Boolean(enabled),
      };
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({ safety_policy: safetyPolicy })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_KILL_SWITCH_UPDATE_FAILED');
      return data || null;
    },
  };
}

export async function handleAuthorizedV1AdminAccountsRequest(request, authorization, {
  accountStore,
  env = {},
} = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!accountStore) return json({ ok: false, reason: 'ACCOUNT_STORE_UNAVAILABLE' }, 503);

  const url = new URL(request.url);
  const prefix = '/api/v1/admin/accounts';
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    return json({ ok: false, reason: 'ADMIN_ACCOUNT_ROUTE_NOT_FOUND' }, 404);
  }

  if (url.pathname === prefix) {
    if (request.method !== 'GET') {
      return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
    }
    if (!can(authorization, 'accounts.read')) {
      return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    }
    try {
      const accounts = await accountStore.listAccounts(workspaceId);
      return json({
        ok: true,
        workspaceId,
        masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env),
        accounts: (accounts || []).map(publicAccount),
      });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_LIST_FAILED' }, 503);
    }
  }

  const rest = url.pathname.slice(prefix.length + 1).split('/').filter(Boolean);
  const accountId = rest[0] ? decodeURIComponent(rest[0]) : '';
  const action = rest[1] ?? null;
  if (!accountId || !action || rest.length !== 2) {
    return json({ ok: false, reason: 'ADMIN_ACCOUNT_ROUTE_NOT_FOUND' }, 404);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }
  if (!can(authorization, 'accounts.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }

  const body = await readJson(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  if (typeof body.enabled !== 'boolean') return json({ ok: false, reason: 'ENABLED_BOOLEAN_REQUIRED' }, 400);

  try {
    let account;
    if (action === 'execution') {
      account = await accountStore.setExecutionEnabled(workspaceId, accountId, body.enabled);
    } else if (action === 'kill-switch') {
      account = await accountStore.setKillSwitch(workspaceId, accountId, body.enabled);
    } else {
      return json({ ok: false, reason: 'ADMIN_ACCOUNT_ROUTE_NOT_FOUND' }, 404);
    }

    if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
    return json({
      ok: true,
      workspaceId,
      masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env),
      account: publicAccount(account),
    });
  } catch {
    return json({ ok: false, reason: 'ACCOUNT_CONTROL_UPDATE_FAILED' }, 503);
  }
}
