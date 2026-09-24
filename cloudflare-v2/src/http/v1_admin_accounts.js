import { hasTradingPermission } from '../security/trading_permissions.js';
import {
  encryptConnectionCredentials,
  validateConnectionCredentials,
} from '../security/connection_credentials.js';

const ACCOUNT_SELECT = [
  'id', 'workspace_id', 'account_label', 'platform', 'account_id', 'server_name',
  'lot_sizing_type', 'lot_value', 'lot_sizing_config', 'is_active', 'execution_enabled', 'safety_policy',
  'fast_entry_policy', 'entry_zone_policy', 'credential_ciphertext', 'created_at',
].join(',');

const SUPPORTED_BROKER_PLATFORMS = new Set(['mt5', 'ctrader']);
const ENTRY_ZONE_MODES = new Set(['market_if_inside', 'midpoint', 'lower', 'upper', 'market_only']);
const ALWAYS_ON_FAST_ENTRY_POLICY = Object.freeze({ enabled: true, mode: 'execute_immediately', locked: true });
const DEFAULT_ENTRY_ZONE_POLICY = Object.freeze({ mode: 'market_if_inside' });

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

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function legAllocationFromConfig(value) {
  const config = safeObject(value);
  const mode = String(config.legAllocation ?? 'per_target').trim().toLowerCase();
  return ['per_target', 'split_total'].includes(mode) ? mode : null;
}

function sizingConfigFor(type, raw = {}) {
  const config = safeObject(raw);
  const legAllocation = legAllocationFromConfig(config);
  if (!legAllocation) return null;
  if (type === 'adaptive_percent') {
    const percent = Number(config.percent);
    return percent > 0 && percent <= 100 ? { percent, legAllocation } : null;
  }
  if (type === 'symbol_equivalent') {
    const referenceSymbol = requiredText(config.referenceSymbol);
    return referenceSymbol ? { referenceSymbol, legAllocation } : null;
  }
  if (type === 'balance_percent') {
    const percent = Number(config.percent);
    return percent > 0 && percent <= 100 ? { percent, legAllocation } : null;
  }
  return { legAllocation };
}

function canonicalEntryZonePolicy(value) {
  const raw = safeObject(value);
  const mode = String(raw.mode ?? '').trim().toLowerCase();
  return { mode: ENTRY_ZONE_MODES.has(mode) ? mode : DEFAULT_ENTRY_ZONE_POLICY.mode };
}

function publicAccount(account = {}) {
  const credentialConfigured = Boolean(
    account.credential_ciphertext
    ?? account.credentialCiphertext
    ?? account.credentialConfigured
    ?? account.credentialsConfigured,
  );
  const safetyPolicy = account.safety_policy ?? account.safetyPolicy ?? {};
  return {
    id: account.id,
    label: account.account_label ?? account.label ?? null,
    platform: account.platform ?? null,
    accountId: account.account_id ?? account.accountId ?? null,
    serverName: account.server_name ?? account.serverName ?? null,
    active: Boolean(account.is_active ?? account.active),
    executionEnabled: Boolean(account.execution_enabled ?? account.executionEnabled),
    killSwitch: Boolean(safetyPolicy?.killSwitch),
    autoTpProtection: safetyPolicy?.autoTpProtection === true,
    lotSizingType: account.lot_sizing_type ?? account.lotSizingType ?? null,
    lotValue: account.lot_value ?? account.lotValue ?? null,
    lotSizingConfig: { ...safeObject(account.lot_sizing_config ?? account.lotSizingConfig) },
    fastEntryPolicy: { ...ALWAYS_ON_FAST_ENTRY_POLICY },
    entryZonePolicy: canonicalEntryZonePolicy(account.entry_zone_policy ?? account.entryZonePolicy),
    credentialConfigured,
    createdAt: account.created_at ?? account.createdAt ?? null,
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

function requiredText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseAccountCreation(body) {
  const platform = requiredText(body.platform)?.toLowerCase() ?? null;
  const label = requiredText(body.label ?? body.accountLabel ?? body.account_label);
  const accountId = requiredText(body.accountId ?? body.account_id);
  const serverName = requiredText(body.serverName ?? body.server_name);
  const lotSizingType = (requiredText(body.lotSizingType ?? body.lot_sizing_type) ?? 'fixed').toLowerCase();
  const lotValue = optionalNumber(body.lotValue ?? body.lot_value);
  const lotSizingConfig = safeObject(body.lotSizingConfig ?? body.lot_sizing_config);

  if (!platform || !SUPPORTED_BROKER_PLATFORMS.has(platform)) {
    return { ok: false, reason: 'ACCOUNT_PLATFORM_UNSUPPORTED' };
  }
  if (!label || !accountId || lotValue === undefined || !(Number(lotValue) > 0)) {
    return { ok: false, reason: 'ACCOUNT_CONFIGURATION_INVALID' };
  }
  if (!['fixed', 'adaptive_percent', 'symbol_equivalent', 'balance_percent'].includes(lotSizingType)) {
    return { ok: false, reason: 'ACCOUNT_LOT_SIZING_TYPE_INVALID' };
  }
  const normalizedSizingConfig = sizingConfigFor(lotSizingType, lotSizingConfig);
  if (!normalizedSizingConfig) {
    return { ok: false, reason: 'ACCOUNT_LOT_SIZING_CONFIG_INVALID' };
  }

  try {
    validateConnectionCredentials(platform, body.credentials);
  } catch {
    return { ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' };
  }

  const safetyPolicy = {
    ...safeObject(body.safetyPolicy ?? body.safety_policy),
    killSwitch: true,
  };

  return {
    ok: true,
    credentials: body.credentials,
    input: {
      label,
      platform,
      accountId,
      serverName,
      lotSizingType,
      lotValue,
      lotSizingConfig: normalizedSizingConfig,
      active: false,
      executionEnabled: false,
      safetyPolicy,
      fastEntryPolicy: { ...ALWAYS_ON_FAST_ENTRY_POLICY },
      entryZonePolicy: canonicalEntryZonePolicy(body.entryZonePolicy ?? body.entry_zone_policy),
    },
  };
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

  async function updateSafetyPolicy(workspaceId, accountId, patch, errorCode) {
    const account = await getAccount(workspaceId, accountId);
    if (!account) return null;
    const safetyPolicy = {
      ...(account.safety_policy && typeof account.safety_policy === 'object' ? account.safety_policy : {}),
      ...patch,
    };
    const { data, error } = await supabase
      .from('trade_accounts')
      .update({ safety_policy: safetyPolicy })
      .eq('workspace_id', String(workspaceId))
      .eq('id', String(accountId))
      .select(ACCOUNT_SELECT)
      .maybeSingle();
    if (error) throw new Error(errorCode);
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

    async createAccount(workspaceId, input, credentialCiphertext = input?.credentialCiphertext) {
      if (!workspaceId || !input?.label || !input?.platform || !input?.accountId || !credentialCiphertext) {
        throw new Error('ACCOUNT_CREATE_FAILED');
      }
      const insert = {
        workspace_id: String(workspaceId),
        account_label: String(input.label),
        platform: String(input.platform),
        account_id: String(input.accountId),
        server_name: input.serverName ?? null,
        lot_sizing_type: input.lotSizingType ?? 'fixed',
        lot_value: input.lotValue ?? null,
        lot_sizing_config: safeObject(input.lotSizingConfig),
        is_active: false,
        execution_enabled: false,
        safety_policy: { ...safeObject(input.safetyPolicy), killSwitch: true },
        fast_entry_policy: { ...ALWAYS_ON_FAST_ENTRY_POLICY },
        entry_zone_policy: canonicalEntryZonePolicy(input.entryZonePolicy),
        credential_ciphertext: String(credentialCiphertext),
      };
      const { data, error } = await supabase
        .from('trade_accounts')
        .insert(insert)
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error || !data) throw new Error('ACCOUNT_CREATE_FAILED');
      return data;
    },

    async replaceAccountCredentials(workspaceId, accountId, credentialCiphertext) {
      if (!workspaceId || !accountId || !credentialCiphertext) {
        throw new Error('ACCOUNT_CREDENTIAL_REPLACE_FAILED');
      }
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({ credential_ciphertext: String(credentialCiphertext) })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_CREDENTIAL_REPLACE_FAILED');
      return data || null;
    },

    async setActive(workspaceId, accountId, enabled) {
      const active = Boolean(enabled);
      const update = active
        ? { is_active: true }
        : { is_active: false, execution_enabled: false };
      const { data, error } = await supabase
        .from('trade_accounts')
        .update(update)
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_ACTIVE_UPDATE_FAILED');
      return data || null;
    },

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

    async setFixedLot(workspaceId, accountId, lotValue) {
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({ lot_sizing_type: 'fixed', lot_value: lotValue })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_FIXED_LOT_UPDATE_FAILED');
      return data || null;
    },

    async setAdaptiveLot(workspaceId, accountId, lotValue, percent, legAllocation = 'per_target') {
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({
          lot_sizing_type: 'adaptive_percent',
          lot_value: lotValue,
          lot_sizing_config: { percent, legAllocation },
        })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_ADAPTIVE_LOT_UPDATE_FAILED');
      return data || null;
    },

    async setSymbolEquivalentLot(workspaceId, accountId, lotValue, referenceSymbol, legAllocation = 'per_target') {
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({
          lot_sizing_type: 'symbol_equivalent',
          lot_value: lotValue,
          lot_sizing_config: { referenceSymbol, legAllocation },
        })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_SYMBOL_EQUIVALENT_UPDATE_FAILED');
      return data || null;
    },

    async setBalancePercentLot(workspaceId, accountId, lotValue, percent, legAllocation = 'per_target') {
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({
          lot_sizing_type: 'balance_percent',
          lot_value: lotValue,
          lot_sizing_config: { percent, legAllocation },
        })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_BALANCE_PERCENT_UPDATE_FAILED');
      return data || null;
    },

    async setLegAllocation(workspaceId, accountId, legAllocation) {
      const account = await getAccount(workspaceId, accountId);
      if (!account) return null;
      const current = safeObject(account.lot_sizing_config);
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({ lot_sizing_config: { ...current, legAllocation } })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_LEG_ALLOCATION_UPDATE_FAILED');
      return data || null;
    },

    async setKillSwitch(workspaceId, accountId, enabled) {
      return updateSafetyPolicy(workspaceId, accountId, { killSwitch: Boolean(enabled) }, 'ACCOUNT_KILL_SWITCH_UPDATE_FAILED');
    },

    async setAutoTpProtection(workspaceId, accountId, enabled) {
      return updateSafetyPolicy(workspaceId, accountId, { autoTpProtection: Boolean(enabled) }, 'ACCOUNT_AUTO_TP_PROTECTION_UPDATE_FAILED');
    },

    async setEntryZonePolicy(workspaceId, accountId, policy) {
      const entryZonePolicy = canonicalEntryZonePolicy(policy);
      const { data, error } = await supabase
        .from('trade_accounts')
        .update({ entry_zone_policy: entryZonePolicy, fast_entry_policy: { ...ALWAYS_ON_FAST_ENTRY_POLICY } })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(accountId))
        .select(ACCOUNT_SELECT)
        .maybeSingle();
      if (error) throw new Error('ACCOUNT_ENTRY_ZONE_POLICY_UPDATE_FAILED');
      return data || null;
    },
  };
}

export async function handleAuthorizedV1AdminAccountsRequest(request, authorization, {
  accountStore,
  env = {},
  encryptCredentials = encryptConnectionCredentials,
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
    if (request.method === 'GET') {
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

    if (request.method === 'POST') {
      if (!can(authorization, 'accounts.write')) {
        return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      }
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = parseAccountCreation(body);
      if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      if (!env?.TRADING_MASTER_KEY) {
        return json({ ok: false, reason: 'ACCOUNT_ENCRYPTION_NOT_CONFIGURED' }, 503);
      }

      let credentialCiphertext;
      try {
        credentialCiphertext = await encryptCredentials(parsed.input.platform, parsed.credentials, env.TRADING_MASTER_KEY);
      } catch {
        return json({ ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' }, 400);
      }

      try {
        const input = { ...parsed.input, credentialCiphertext };
        const account = await accountStore.createAccount(workspaceId, input, credentialCiphertext);
        if (!account) return json({ ok: false, reason: 'ACCOUNT_CREATE_FAILED' }, 503);
        return json({
          ok: true,
          workspaceId,
          masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env),
          account: publicAccount({ ...account, credentialConfigured: true }),
        }, 201);
      } catch {
        return json({ ok: false, reason: 'ACCOUNT_CREATE_FAILED' }, 503);
      }
    }

    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  const rest = url.pathname.slice(prefix.length + 1).split('/').filter(Boolean);
  const accountId = rest[0] ? decodeURIComponent(rest[0]) : '';
  const action = rest[1] ?? null;
  if (!accountId || !action || rest.length !== 2) {
    return json({ ok: false, reason: 'ADMIN_ACCOUNT_ROUTE_NOT_FOUND' }, 404);
  }

  if (action === 'credentials') {
    if (request.method !== 'PUT') {
      return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'PUT' });
    }
    if (!can(authorization, 'accounts.write')) {
      return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    }
    if (!env?.TRADING_MASTER_KEY) {
      return json({ ok: false, reason: 'ACCOUNT_ENCRYPTION_NOT_CONFIGURED' }, 503);
    }

    let existing;
    try {
      existing = await accountStore.getAccount(workspaceId, accountId);
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_READ_FAILED' }, 503);
    }
    if (!existing) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);

    const platform = requiredText(existing.platform)?.toLowerCase() ?? null;
    if (!platform || !SUPPORTED_BROKER_PLATFORMS.has(platform)) {
      return json({ ok: false, reason: 'ACCOUNT_PLATFORM_UNSUPPORTED' }, 400);
    }

    const body = await readJson(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    try {
      validateConnectionCredentials(platform, body.credentials);
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' }, 400);
    }

    let credentialCiphertext;
    try {
      credentialCiphertext = await encryptCredentials(platform, body.credentials, env.TRADING_MASTER_KEY);
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_CREDENTIALS_INVALID' }, 400);
    }

    try {
      const account = await accountStore.replaceAccountCredentials(workspaceId, accountId, credentialCiphertext);
      if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({
        ok: true,
        workspaceId,
        masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env),
        account: publicAccount({ ...account, credentialConfigured: true }),
      });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_CREDENTIAL_REPLACE_FAILED' }, 503);
    }
  }

  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }
  if (!can(authorization, 'accounts.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }

  const body = await readJson(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);

  if (action === 'fixed-lot') {
    if (typeof body.lotValue !== 'number' || !Number.isFinite(body.lotValue) || body.lotValue <= 0) {
      return json({ ok: false, reason: 'FIXED_LOT_POSITIVE_NUMBER_REQUIRED' }, 400);
    }
    try {
      const account = await accountStore.setFixedLot(workspaceId, accountId, body.lotValue);
      if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({
        ok: true,
        workspaceId,
        masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env),
        account: publicAccount(account),
      });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_FIXED_LOT_UPDATE_FAILED' }, 503);
    }
  }

  if (action === 'adaptive-lot') {
    const lotValue = Number(body.lotValue);
    const percent = Number(body.percent);
    if (!(lotValue > 0)) return json({ ok: false, reason: 'ADAPTIVE_REFERENCE_LOT_POSITIVE_NUMBER_REQUIRED' }, 400);
    if (!(percent > 0 && percent <= 100)) return json({ ok: false, reason: 'ADAPTIVE_PERCENT_RANGE_REQUIRED' }, 400);
    const legAllocation = String(body.legAllocation ?? 'per_target').trim().toLowerCase();
    if (!['per_target','split_total'].includes(legAllocation)) return json({ ok: false, reason: 'LEG_ALLOCATION_INVALID' }, 400);
    try {
      const account = await accountStore.setAdaptiveLot(workspaceId, accountId, lotValue, percent, legAllocation);
      if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({
        ok: true,
        workspaceId,
        masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env),
        account: publicAccount(account),
      });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_ADAPTIVE_LOT_UPDATE_FAILED' }, 503);
    }
  }

  if (action === 'symbol-equivalent-lot') {
    const lotValue = Number(body.lotValue);
    const referenceSymbol = requiredText(body.referenceSymbol);
    const legAllocation = String(body.legAllocation ?? 'per_target').trim().toLowerCase();
    if (!(lotValue > 0)) return json({ ok: false, reason: 'SYMBOL_EQUIVALENT_REFERENCE_LOT_REQUIRED' }, 400);
    if (!referenceSymbol) return json({ ok: false, reason: 'SYMBOL_EQUIVALENT_REFERENCE_SYMBOL_REQUIRED' }, 400);
    if (!['per_target','split_total'].includes(legAllocation)) return json({ ok: false, reason: 'LEG_ALLOCATION_INVALID' }, 400);
    try {
      const account = await accountStore.setSymbolEquivalentLot(workspaceId, accountId, lotValue, referenceSymbol, legAllocation);
      if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env), account: publicAccount(account) });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_SYMBOL_EQUIVALENT_UPDATE_FAILED' }, 503);
    }
  }

  if (action === 'balance-percent-lot') {
    const lotValue = Number(body.lotValue);
    const percent = Number(body.percent);
    const legAllocation = String(body.legAllocation ?? 'per_target').trim().toLowerCase();
    if (!(lotValue > 0)) return json({ ok: false, reason: 'BALANCE_PERCENT_MAX_LOT_REQUIRED' }, 400);
    if (!(percent > 0 && percent <= 100)) return json({ ok: false, reason: 'BALANCE_PERCENT_RANGE_REQUIRED' }, 400);
    if (!['per_target','split_total'].includes(legAllocation)) return json({ ok: false, reason: 'LEG_ALLOCATION_INVALID' }, 400);
    try {
      const account = await accountStore.setBalancePercentLot(workspaceId, accountId, lotValue, percent, legAllocation);
      if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env), account: publicAccount(account) });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_BALANCE_PERCENT_UPDATE_FAILED' }, 503);
    }
  }

  if (action === 'leg-allocation') {
    const legAllocation = String(body.legAllocation ?? '').trim().toLowerCase();
    if (!['per_target','split_total'].includes(legAllocation)) return json({ ok: false, reason: 'LEG_ALLOCATION_INVALID' }, 400);
    try {
      const account = await accountStore.setLegAllocation(workspaceId, accountId, legAllocation);
      if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env), account: publicAccount(account) });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_LEG_ALLOCATION_UPDATE_FAILED' }, 503);
    }
  }

  if (action === 'entry-zone-policy') {
    const mode = requiredText(body.mode)?.toLowerCase() ?? null;
    if (!mode || !ENTRY_ZONE_MODES.has(mode)) {
      return json({ ok: false, reason: 'ENTRY_ZONE_POLICY_MODE_INVALID' }, 400);
    }
    try {
      const account = await accountStore.setEntryZonePolicy(workspaceId, accountId, { mode });
      if (!account) return json({ ok: false, reason: 'ACCOUNT_NOT_FOUND' }, 404);
      return json({
        ok: true,
        workspaceId,
        masterBrokerExecutionEnabled: masterBrokerExecutionEnabled(env),
        account: publicAccount(account),
      });
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_ENTRY_ZONE_POLICY_UPDATE_FAILED' }, 503);
    }
  }

  if (typeof body.enabled !== 'boolean') return json({ ok: false, reason: 'ENABLED_BOOLEAN_REQUIRED' }, 400);

  try {
    let account;
    if (action === 'active') {
      account = await accountStore.setActive(workspaceId, accountId, body.enabled);
    } else if (action === 'execution') {
      account = await accountStore.setExecutionEnabled(workspaceId, accountId, body.enabled);
    } else if (action === 'kill-switch') {
      account = await accountStore.setKillSwitch(workspaceId, accountId, body.enabled);
    } else if (action === 'auto-tp-protection') {
      account = await accountStore.setAutoTpProtection(workspaceId, accountId, body.enabled);
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
