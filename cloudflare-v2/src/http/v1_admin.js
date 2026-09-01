import { authenticateTradingBearer } from '../security/zitadel_auth.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function defaultSupabaseFactory(env) {
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE || env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

function publicWorkspace(workspace = {}) {
  return {
    id: workspace.id,
    name: workspace.name,
    owner_email: workspace.owner_email,
    custom_domain: workspace.custom_domain ?? null,
    tier: workspace.tier,
    zitadel_org_id: workspace.zitadel_org_id,
    trading_access_enabled: Boolean(workspace.trading_access_enabled),
    trading_required_role: workspace.trading_required_role || 'trading_access',
    tg_admin_chat_id: workspace.tg_admin_chat_id ?? null,
    tg_vip_chat_id: workspace.tg_vip_chat_id ?? null,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
  };
}

export async function authorizeV1AdminRequest(request, env = {}, {
  supabase,
  authenticateFn = authenticateTradingBearer,
} = {}) {
  const workspaceId = request.headers.get('X-Mkety-Workspace-Id');
  if (!workspaceId) return { ok: false, status: 400, reason: 'MISSING_WORKSPACE_SELECTOR' };
  if (!supabase?.from) return { ok: false, status: 503, reason: 'ADMIN_DATABASE_UNAVAILABLE' };

  const { data: workspace, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', String(workspaceId))
    .maybeSingle();

  if (error || !workspace?.id) return { ok: false, status: 404, reason: 'WORKSPACE_NOT_FOUND' };
  if (!workspace.trading_access_enabled) return { ok: false, status: 403, reason: 'TRADING_ACCESS_DISABLED' };
  if (!workspace.zitadel_org_id) return { ok: false, status: 403, reason: 'WORKSPACE_NOT_BOUND_TO_ZITADEL_ORG' };

  const issuer = env.ZITADEL_ISSUER;
  const audience = env.ZITADEL_AUDIENCE;
  const jwksUrl = env.ZITADEL_JWKS_URL;
  const usesProductionVerifier = authenticateFn === authenticateTradingBearer;
  if (usesProductionVerifier && (!issuer || !audience || !jwksUrl)) {
    return { ok: false, status: 503, reason: 'ZITADEL_NOT_CONFIGURED' };
  }

  const requiredRole = workspace.trading_required_role || env.ZITADEL_TRADING_ROLE || 'trading_access';
  const auth = await authenticateFn(request, {
    issuer,
    audience,
    jwksUrl,
    requiredRole,
    projectId: env.ZITADEL_PROJECT_ID,
    workspace: { id: workspace.id, zitadelOrgId: workspace.zitadel_org_id },
  });

  if (!auth?.ok) {
    const unauthorized = ['MISSING_BEARER_TOKEN', 'MALFORMED_TOKEN', 'INVALID_SIGNATURE', 'TOKEN_EXPIRED', 'TOKEN_NOT_YET_VALID', 'INVALID_ISSUER', 'INVALID_AUDIENCE', 'SIGNING_KEY_NOT_FOUND', 'JWKS_FETCH_FAILED'];
    return { ok: false, status: unauthorized.includes(auth?.reason) ? 401 : 403, reason: auth?.reason || 'ADMIN_FORBIDDEN' };
  }

  return { ok: true, workspace, auth };
}

export async function handleV1AdminRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  authenticateFn = authenticateTradingBearer,
} = {}) {
  let supabase;
  try {
    supabase = await supabaseFactory(env);
  } catch {
    return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503);
  }

  const authorization = await authorizeV1AdminRequest(request, env, { supabase, authenticateFn });
  if (!authorization.ok) return json({ ok: false, reason: authorization.reason }, authorization.status);

  const url = new URL(request.url);
  if (url.pathname === '/api/v1/admin/workspace' && request.method === 'GET') {
    return json({
      ok: true,
      subject: authorization.auth.subject,
      workspace: publicWorkspace(authorization.workspace),
    });
  }

  return json({ ok: false, reason: 'ADMIN_ROUTE_NOT_FOUND' }, 404);
}
