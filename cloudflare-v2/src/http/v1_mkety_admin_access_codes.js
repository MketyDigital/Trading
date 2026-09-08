import {
  hashTradingAccessCode,
  normalizeTradingAccessCode,
} from '../access/trading_access_codes.js';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function bearerOrHeaderSecret(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return request.headers.get('X-Mkety-Admin-Secret') || '';
}

function authorizeMketyAdmin(request, env = {}) {
  const expected = String(env.MKETY_TRADING_ADMIN_SECRET || env.TRADING_ADMIN_SECRET || '').trim();
  if (!expected) return { ok: false, status: 503, reason: 'MKETY_ADMIN_SECRET_NOT_CONFIGURED' };
  const provided = String(bearerOrHeaderSecret(request)).trim();
  if (!provided || provided !== expected) return { ok: false, status: 401, reason: 'MKETY_ADMIN_UNAUTHORIZED' };
  return { ok: true };
}

async function defaultSupabaseFactory(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function normalizeEntitlements(entitlements = {}) {
  const sourceTypes = Array.isArray(entitlements.sourceTypes) ? entitlements.sourceTypes.map(String) : ['telegram', 'tradingview'];
  const brokerModes = Array.isArray(entitlements.brokerModes) ? entitlements.brokerModes.map(String) : ['demo'];
  return {
    customSubdomain: Boolean(entitlements.customSubdomain),
    customHostname: Boolean(entitlements.customHostname),
    sourceTypes,
    brokerModes: brokerModes.includes('live') ? ['demo'] : brokerModes,
    liveExecution: false,
    maxTeamMembers: Math.max(1, Number.parseInt(entitlements.maxTeamMembers ?? 1, 10) || 1),
    destinations: Array.isArray(entitlements.destinations) ? entitlements.destinations.map(String) : ['telegram', 'audit_only'],
  };
}

function safePublicAccessCode(row = {}, plainCode = undefined) {
  const out = {
    id: row.id,
    workspaceId: row.workspace_id ?? row.workspaceId,
    workspaceDisplayName: row.workspace_display_name ?? row.workspaceDisplayName ?? null,
    ownerEmail: row.owner_email ?? row.ownerEmail ?? null,
    ownerName: row.owner_name ?? row.ownerName ?? null,
    status: row.status,
    maxRedemptions: row.max_redemptions ?? row.maxRedemptions,
    redeemedCount: row.redeemed_count ?? row.redeemedCount,
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    entitlements: row.entitlements || {},
    metadata: row.metadata || {},
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
  if (plainCode) out.plainCode = plainCode;
  return out;
}

function randomCode(randomUUID = crypto.randomUUID) {
  const raw = String(randomUUID()).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16);
  return `TRD-MKETY-${raw}`;
}

export async function createMketyAdminAccessCodePlan(input = {}, {
  now = new Date(),
  randomUUID = crypto.randomUUID,
} = {}) {
  const ownerEmail = text(input.ownerEmail ?? input.owner_email)?.toLowerCase();
  const ownerName = text(input.ownerName ?? input.owner_name);
  const workspaceName = text(input.workspaceName ?? input.workspace_name);
  if (!ownerEmail || !ownerEmail.includes('@')) return { ok: false, reason: 'OWNER_EMAIL_REQUIRED' };
  if (!workspaceName) return { ok: false, reason: 'WORKSPACE_NAME_REQUIRED' };

  const plainCode = normalizeTradingAccessCode(input.code || randomCode(randomUUID));
  if (!plainCode) return { ok: false, reason: 'ACCESS_CODE_REQUIRED' };
  const workspaceId = text(input.workspaceId ?? input.workspace_id) || randomUUID();
  const expiresAt = text(input.expiresAt ?? input.expires_at) || new Date(new Date(now).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const maxRedemptions = Math.max(1, Number.parseInt(input.maxRedemptions ?? input.max_redemptions ?? 1, 10) || 1);
  const entitlements = normalizeEntitlements(input.entitlements || {});
  const codeHash = await hashTradingAccessCode(plainCode);

  return {
    ok: true,
    plainCode,
    workspace: { id: workspaceId, displayName: workspaceName },
    owner: { email: ownerEmail, name: ownerName },
    entitlements,
    maxRedemptions,
    expiresAt,
    metadata: {
      ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}),
      createdBy: 'mkety-admin-api',
    },
    record: {
      code_hash: codeHash,
      product: 'trading',
      status: 'active',
      workspace_id: workspaceId,
      workspace_display_name: workspaceName,
      owner_email: ownerEmail,
      owner_name: ownerName,
      role: 'owner',
      entitlements,
      max_redemptions: maxRedemptions,
      redeemed_count: 0,
      expires_at: expiresAt,
      metadata: {
        ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}),
        createdBy: 'mkety-admin-api',
      },
    },
  };
}

const ACCESS_CODE_PUBLIC_SELECT = 'id,workspace_id,workspace_display_name,owner_email,owner_name,status,max_redemptions,redeemed_count,expires_at,entitlements,metadata,created_at,updated_at';

export function createMketyAdminAccessCodeStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  return {
    async listAccessCodes() {
      const { data, error } = await supabase
        .from('trading_access_codes')
        .select(ACCESS_CODE_PUBLIC_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw new Error('ACCESS_CODE_LIST_FAILED');
      return data || [];
    },
    async createAccessCode(plan) {
      const workspaceRow = {
        id: plan.workspace.id,
        display_name: plan.workspace.displayName,
        owner_email: plan.owner.email,
        trading_access_enabled: true,
        metadata: { accessCodeProvisioned: true, entitlements: plan.entitlements },
        updated_at: new Date().toISOString(),
      };
      const { error: workspaceError } = await supabase
        .from('trading_workspace_access')
        .upsert(workspaceRow, { onConflict: 'id' });
      if (workspaceError) throw new Error('ACCESS_CODE_WORKSPACE_CREATE_FAILED');

      const { data, error } = await supabase
        .from('trading_access_codes')
        .insert(plan.record)
        .select(ACCESS_CODE_PUBLIC_SELECT)
        .maybeSingle();
      if (error || !data) throw new Error('ACCESS_CODE_CREATE_FAILED');
      return data;
    },
    async revokeAccessCode(id) {
      const accessCodeId = text(id);
      if (!accessCodeId) throw new Error('ACCESS_CODE_ID_REQUIRED');
      const { data, error } = await supabase
        .from('trading_access_codes')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', accessCodeId)
        .select(ACCESS_CODE_PUBLIC_SELECT)
        .maybeSingle();
      if (error || !data) throw new Error('ACCESS_CODE_REVOKE_FAILED');
      return data;
    },
  };
}

function revokeIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/api\/v1\/mkety-admin\/access-codes\/([^/]+)\/revoke$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function handleMketyAdminAccessCodesRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  store = null,
  now = new Date(),
  randomUUID = crypto.randomUUID,
} = {}) {
  const auth = authorizeMketyAdmin(request, env);
  if (!auth.ok) return json({ ok: false, reason: auth.reason }, auth.status);

  let accessStore = store;
  if (!accessStore) {
    try {
      accessStore = createMketyAdminAccessCodeStore(await supabaseFactory(env));
    } catch {
      return json({ ok: false, reason: 'MKETY_ADMIN_ACCESS_CODE_STORE_UNAVAILABLE' }, 503);
    }
  }

  const url = new URL(request.url);
  const revokeId = revokeIdFromPath(url.pathname);
  if (revokeId) {
    if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
    if (typeof accessStore.revokeAccessCode !== 'function') return json({ ok: false, reason: 'ACCESS_CODE_REVOKE_UNAVAILABLE' }, 503);
    try {
      const row = await accessStore.revokeAccessCode(revokeId);
      return json({ ok: true, accessCode: safePublicAccessCode(row) });
    } catch {
      return json({ ok: false, reason: 'ACCESS_CODE_REVOKE_FAILED' }, 503);
    }
  }

  if (url.pathname !== '/api/v1/mkety-admin/access-codes') {
    return json({ ok: false, reason: 'MKETY_ADMIN_ROUTE_NOT_FOUND' }, 404);
  }

  if (request.method === 'GET') {
    try {
      const rows = await accessStore.listAccessCodes();
      return json({ ok: true, accessCodes: rows.map((row) => safePublicAccessCode(row)) });
    } catch {
      return json({ ok: false, reason: 'ACCESS_CODE_LIST_FAILED' }, 503);
    }
  }

  if (request.method === 'POST') {
    const body = await readJson(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    const plan = await createMketyAdminAccessCodePlan(body, { now, randomUUID });
    if (!plan.ok) return json({ ok: false, reason: plan.reason }, 400);
    try {
      const row = await accessStore.createAccessCode(plan);
      return json({ ok: true, accessCode: safePublicAccessCode(row, plan.plainCode) }, 201);
    } catch {
      return json({ ok: false, reason: 'ACCESS_CODE_CREATE_FAILED' }, 503);
    }
  }

  return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
}
