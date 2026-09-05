import { authenticateMketyAccessBearer } from '../security/mkety_access_assertion.js';
import { createTradingMembershipStore } from '../security/trading_membership_store.js';
import {
  canonicalTradingHostsFromEnv,
  createTradingHostnameStore,
  resolveTradingRequestHostname,
} from '../security/trading_hostname_resolver.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { handleAuthorizedV1AdminMembersRequest } from './v1_admin_members.js';
import { createAdminSourceStore, handleAuthorizedV1AdminSourcesRequest } from './v1_admin_sources.js';
import { createAdminAccountStore, handleAuthorizedV1AdminAccountsRequest } from './v1_admin_accounts.js';
import {
  createAdminOperationsStore,
  handleAuthorizedV1AdminOperationsRequest,
  handleAuthorizedV1AdminEventAuditRequest,
} from './v1_admin_operations.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
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
    name: workspace.display_name ?? null,
    owner_email: workspace.owner_email ?? null,
    trading_access_enabled: Boolean(workspace.trading_access_enabled),
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
  };
}

export async function authorizeV1AdminRequest(request, env = {}, {
  supabase,
  authenticateFn = authenticateMketyAccessBearer,
  membershipStoreFactory = createTradingMembershipStore,
  hostnameStoreFactory = createTradingHostnameStore,
  resolveHostnameFn = resolveTradingRequestHostname,
} = {}) {
  const workspaceId = request.headers.get('X-Mkety-Workspace-Id');
  if (!workspaceId) return { ok: false, status: 400, reason: 'MISSING_WORKSPACE_SELECTOR' };
  if (!supabase?.from) return { ok: false, status: 503, reason: 'ADMIN_DATABASE_UNAVAILABLE' };

  if (enabled(env.TRADING_CUSTOM_HOSTNAMES_ENABLED)) {
    let hostnameStore;
    try {
      hostnameStore = hostnameStoreFactory(supabase);
    } catch {
      return { ok: false, status: 503, reason: 'TRADING_HOSTNAME_STORE_UNAVAILABLE' };
    }

    const hostname = await resolveHostnameFn(request, {
      hostnameStore,
      canonicalHosts: canonicalTradingHostsFromEnv(env),
    });

    if (!hostname?.ok) {
      const serviceFailure = ['TRADING_HOSTNAME_STORE_UNAVAILABLE', 'TRADING_HOSTNAME_LOOKUP_FAILED'];
      return {
        ok: false,
        status: serviceFailure.includes(hostname?.reason) ? 503 : hostname?.reason === 'INVALID_TRADING_HOSTNAME' ? 400 : 404,
        reason: hostname?.reason || 'TRADING_HOSTNAME_NOT_ACTIVE',
      };
    }

    if (hostname.kind === 'custom' && String(hostname.workspaceId) !== String(workspaceId)) {
      return { ok: false, status: 403, reason: 'TRADING_HOSTNAME_WORKSPACE_MISMATCH' };
    }
  }

  const { data: workspace, error } = await supabase
    .from('trading_workspace_access')
    .select('*')
    .eq('id', String(workspaceId))
    .maybeSingle();

  if (error || !workspace?.id) return { ok: false, status: 404, reason: 'WORKSPACE_NOT_FOUND' };
  if (!workspace.trading_access_enabled) return { ok: false, status: 403, reason: 'TRADING_ACCESS_DISABLED' };

  const issuer = env.MKETY_ACCESS_ISSUER;
  const audience = env.MKETY_ACCESS_AUDIENCE;
  const jwksUrl = env.MKETY_ACCESS_JWKS_URL;
  const usesProductionVerifier = authenticateFn === authenticateMketyAccessBearer;
  if (usesProductionVerifier && (!issuer || !audience || !jwksUrl)) {
    return { ok: false, status: 503, reason: 'MKETY_ACCESS_GATE_NOT_CONFIGURED' };
  }

  const auth = await authenticateFn(request, {
    issuer,
    audience,
    jwksUrl,
    requestedWorkspaceId: workspace.id,
  });

  if (!auth?.ok) {
    const unauthorized = [
      'MISSING_BEARER_TOKEN', 'MALFORMED_TOKEN', 'INVALID_SIGNATURE', 'TOKEN_EXPIRED',
      'TOKEN_NOT_YET_VALID', 'INVALID_ISSUER', 'INVALID_AUDIENCE', 'SIGNING_KEY_NOT_FOUND',
      'JWKS_FETCH_FAILED',
    ];
    return { ok: false, status: unauthorized.includes(auth?.reason) ? 401 : 403, reason: auth?.reason || 'ADMIN_FORBIDDEN' };
  }

  let membershipStore;
  try {
    membershipStore = membershipStoreFactory(supabase);
  } catch {
    return { ok: false, status: 503, reason: 'TRADING_MEMBERSHIP_STORE_UNAVAILABLE' };
  }

  let membership;
  try {
    membership = await membershipStore.getMembership(workspace.id, auth.subject);
  } catch {
    return { ok: false, status: 503, reason: 'TRADING_MEMBERSHIP_LOOKUP_FAILED' };
  }

  if (
    !membership?.enabled ||
    String(membership.workspaceId) !== String(workspace.id) ||
    String(membership.subject) !== String(auth.subject)
  ) {
    return { ok: false, status: 403, reason: 'TRADING_MEMBERSHIP_DISABLED_OR_MISSING' };
  }

  return { ok: true, workspace, auth, membership };
}

export async function handleV1AdminRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  authenticateFn = authenticateMketyAccessBearer,
  membershipStoreFactory = createTradingMembershipStore,
  hostnameStoreFactory = createTradingHostnameStore,
  resolveHostnameFn = resolveTradingRequestHostname,
  sourceStoreFactory = createAdminSourceStore,
  accountStoreFactory = createAdminAccountStore,
  operationsStoreFactory = createAdminOperationsStore,
} = {}) {
  let supabase;
  try {
    supabase = await supabaseFactory(env);
  } catch {
    return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503);
  }

  const authorization = await authorizeV1AdminRequest(request, env, {
    supabase,
    authenticateFn,
    membershipStoreFactory,
    hostnameStoreFactory,
    resolveHostnameFn,
  });
  if (!authorization.ok) return json({ ok: false, reason: authorization.reason }, authorization.status);

  const url = new URL(request.url);
  if (url.pathname === '/api/v1/admin/workspace' && request.method === 'GET') {
    if (!hasTradingPermission(authorization.membership?.role, 'workspace.read')) {
      return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    }
    return json({
      ok: true,
      subject: authorization.auth.subject,
      workspace: publicWorkspace(authorization.workspace),
    });
  }

  if (url.pathname === '/api/v1/admin/operations') {
    let operationsStore;
    try {
      operationsStore = operationsStoreFactory(supabase);
    } catch {
      return json({ ok: false, reason: 'OPERATIONS_STORE_UNAVAILABLE' }, 503);
    }
    return handleAuthorizedV1AdminOperationsRequest(request, authorization, { operationsStore });
  }

  const eventAuditMatch = url.pathname.match(/^\/api\/v1\/admin\/events\/([^/]+)\/audit$/);
  if (eventAuditMatch) {
    let eventId;
    try {
      eventId = decodeURIComponent(eventAuditMatch[1]);
    } catch {
      return json({ ok: false, reason: 'INVALID_EVENT_ID' }, 400);
    }
    if (!String(eventId).trim()) return json({ ok: false, reason: 'INVALID_EVENT_ID' }, 400);

    let operationsStore;
    try {
      operationsStore = operationsStoreFactory(supabase);
    } catch {
      return json({ ok: false, reason: 'OPERATIONS_STORE_UNAVAILABLE' }, 503);
    }
    return handleAuthorizedV1AdminEventAuditRequest(request, authorization, { eventId, operationsStore });
  }

  if (url.pathname === '/api/v1/admin/members' || url.pathname.startsWith('/api/v1/admin/members/')) {
    let membershipStore;
    try {
      membershipStore = membershipStoreFactory(supabase);
    } catch {
      return json({ ok: false, reason: 'TRADING_MEMBERSHIP_STORE_UNAVAILABLE' }, 503);
    }
    return handleAuthorizedV1AdminMembersRequest(request, authorization, { membershipStore });
  }

  if (url.pathname === '/api/v1/admin/sources' || url.pathname.startsWith('/api/v1/admin/sources/')) {
    let sourceStore;
    try {
      sourceStore = sourceStoreFactory(supabase);
    } catch {
      return json({ ok: false, reason: 'SOURCE_STORE_UNAVAILABLE' }, 503);
    }
    return handleAuthorizedV1AdminSourcesRequest(request, authorization, { sourceStore });
  }

  if (url.pathname === '/api/v1/admin/accounts' || url.pathname.startsWith('/api/v1/admin/accounts/')) {
    let accountStore;
    try {
      accountStore = accountStoreFactory(supabase);
    } catch {
      return json({ ok: false, reason: 'ACCOUNT_STORE_UNAVAILABLE' }, 503);
    }
    return handleAuthorizedV1AdminAccountsRequest(request, authorization, { accountStore, env });
  }

  return json({ ok: false, reason: 'ADMIN_ROUTE_NOT_FOUND' }, 404);
}
