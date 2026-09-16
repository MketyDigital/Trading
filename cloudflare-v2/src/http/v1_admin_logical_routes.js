import { authorizeV1AdminRequest } from './v1_admin.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { canUseDestinationType, isAccessCodeProvisionedWorkspace } from '../security/trading_entitlements.js';
import { groupLogicalRoutes, planLogicalRouteReconcile } from '../routes/logical_route_admin.js';

function text(value) {
  return String(value ?? '').trim();
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

async function defaultSupabaseFactory(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

function normalizeSymbols(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('ROUTE_FILTERS_INVALID');
  return [...new Set(value.map((item) => text(item).toUpperCase()).filter(Boolean))];
}

function normalizeFilters(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ROUTE_FILTERS_INVALID');
  const out = { ...value };
  const allowed = normalizeSymbols(value.allowedCanonicalSymbols ?? value.allowed_canonical_symbols);
  const blocked = normalizeSymbols(value.blockedCanonicalSymbols ?? value.blocked_canonical_symbols);
  delete out.allowed_canonical_symbols;
  delete out.blocked_canonical_symbols;
  if (allowed.length) out.allowedCanonicalSymbols = allowed;
  else delete out.allowedCanonicalSymbols;
  if (blocked.length) out.blockedCanonicalSymbols = blocked;
  else delete out.blockedCanonicalSymbols;
  return out;
}

function permission(authorization, name) {
  return hasTradingPermission(authorization?.membership?.role, name);
}

async function listLogicalRoutes(supabase, workspaceId) {
  const { data, error } = await supabase
    .from('source_destination_routes')
    .select('id,workspace_id,source_connection_id,source_feed_id,destination_id,route_name,priority,is_active,filters')
    .eq('workspace_id', workspaceId)
    .order('priority', { ascending: true });
  if (error) throw new Error('LOGICAL_ROUTE_LIST_FAILED');
  return groupLogicalRoutes(data || []);
}

async function validateAuthorityObjects(supabase, authorization, sourceConnectionId, destinationId, selectedFeedIds) {
  const workspaceId = String(authorization.workspace.id);
  const [{ data: source, error: sourceError }, { data: destination, error: destinationError }] = await Promise.all([
    supabase.from('source_connections').select('id').eq('workspace_id', workspaceId).eq('id', sourceConnectionId).maybeSingle(),
    supabase.from('trading_destinations').select('id,destination_type').eq('workspace_id', workspaceId).eq('id', destinationId).maybeSingle(),
  ]);
  if (sourceError || destinationError) throw new Error('LOGICAL_ROUTE_AUTHORITY_LOOKUP_FAILED');
  if (!source) return { ok: false, status: 404, reason: 'SOURCE_NOT_FOUND' };
  if (!destination) return { ok: false, status: 404, reason: 'DESTINATION_NOT_FOUND' };
  if (isAccessCodeProvisionedWorkspace(authorization)
    && !canUseDestinationType(authorization, destination.destination_type)) {
    return { ok: false, status: 403, reason: 'TRADING_ENTITLEMENT_REQUIRED' };
  }

  if (selectedFeedIds.length) {
    const { data: feeds, error } = await supabase.from('source_feeds')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('source_connection_id', sourceConnectionId)
      .eq('is_active', true)
      .in('id', selectedFeedIds);
    if (error) throw new Error('SOURCE_FEED_LOOKUP_FAILED');
    const found = new Set((feeds || []).map((row) => text(row.id)));
    if (selectedFeedIds.some((id) => !found.has(id))) {
      return { ok: false, status: 400, reason: 'SOURCE_FEED_SELECTION_INVALID' };
    }
  }
  return { ok: true };
}

async function reconcileLogicalRoute(request, authorization, supabase) {
  const workspaceId = String(authorization.workspace.id);
  const body = await readJson(request);
  if (!body) return json({ ok: false, reason: 'INVALID_JSON' }, 400);

  const sourceConnectionId = text(body.sourceConnectionId ?? body.source_connection_id);
  const destinationId = text(body.destinationId ?? body.destination_id);
  const mode = text(body.mode).toLowerCase();
  if (!sourceConnectionId) return json({ ok: false, reason: 'SOURCE_CONNECTION_REQUIRED' }, 400);
  if (!destinationId) return json({ ok: false, reason: 'DESTINATION_REQUIRED' }, 400);
  if (!['all', 'selective'].includes(mode)) return json({ ok: false, reason: 'ROUTE_MODE_INVALID' }, 400);

  const selectedFeedIds = [...new Set((Array.isArray(body.selectedFeedIds) ? body.selectedFeedIds : []).map(text).filter(Boolean))];
  if (mode === 'selective' && selectedFeedIds.length === 0) {
    return json({ ok: false, reason: 'ROUTE_FEEDS_REQUIRED' }, 400);
  }

  let filters;
  try { filters = normalizeFilters(body.filters); }
  catch { return json({ ok: false, reason: 'ROUTE_FILTERS_INVALID' }, 400); }
  const priority = Number(body.priority ?? 100);
  if (!Number.isFinite(priority)) return json({ ok: false, reason: 'ROUTE_PRIORITY_INVALID' }, 400);

  let authority;
  try { authority = await validateAuthorityObjects(supabase, authorization, sourceConnectionId, destinationId, selectedFeedIds); }
  catch { return json({ ok: false, reason: 'LOGICAL_ROUTE_AUTHORITY_LOOKUP_FAILED' }, 503); }
  if (!authority.ok) return json({ ok: false, reason: authority.reason }, authority.status);

  const { data: existingRows, error: readError } = await supabase.from('source_destination_routes')
    .select('id,workspace_id,source_connection_id,source_feed_id,destination_id,route_name,priority,is_active,filters')
    .eq('workspace_id', workspaceId)
    .eq('source_connection_id', sourceConnectionId)
    .eq('destination_id', destinationId)
    .order('priority', { ascending: true });
  if (readError) return json({ ok: false, reason: 'LOGICAL_ROUTE_READ_FAILED' }, 503);

  let plan;
  try {
    plan = planLogicalRouteReconcile({
      existingRows: existingRows || [],
      mode,
      selectedFeedIds,
      settings: {
        routeName: text(body.routeName ?? body.route_name) || null,
        priority,
        filters,
        enabled: body.enabled !== false,
      },
    });
  } catch (error) {
    return json({ ok: false, reason: text(error?.message) || 'LOGICAL_ROUTE_INVALID' }, 400);
  }

  // Fail-closed ordering: remove stale/broad rows first, then update reusable rows,
  // then add new selected rows. A partial failure can narrow authority but cannot
  // silently broaden it; retrying the same request is idempotent and heals state.
  if (plan.deleteIds.length) {
    const { error } = await supabase.from('source_destination_routes').delete()
      .eq('workspace_id', workspaceId).in('id', plan.deleteIds);
    if (error) return json({ ok: false, reason: 'LOGICAL_ROUTE_RECONCILE_FAILED' }, 503);
  }

  for (const item of plan.updates) {
    const { error } = await supabase.from('source_destination_routes')
      .update({ ...item.patch, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', item.id);
    if (error) return json({ ok: false, reason: 'LOGICAL_ROUTE_RECONCILE_FAILED' }, 503);
  }

  for (const item of plan.inserts) {
    const { error } = await supabase.from('source_destination_routes').insert({
      workspace_id: workspaceId,
      source_connection_id: sourceConnectionId,
      destination_id: destinationId,
      source_feed_id: item.source_feed_id,
      route_name: item.route_name,
      priority: item.priority,
      filters: safeObject(item.filters),
      is_active: item.is_active,
    });
    if (error) return json({ ok: false, reason: 'LOGICAL_ROUTE_RECONCILE_FAILED' }, 503);
  }

  let logicalRoutes;
  try { logicalRoutes = await listLogicalRoutes(supabase, workspaceId); }
  catch { return json({ ok: false, reason: 'LOGICAL_ROUTE_LIST_FAILED' }, 503); }
  const logicalRoute = logicalRoutes.find((item) => item.sourceConnectionId === sourceConnectionId && item.destinationId === destinationId) || null;
  return json({ ok: true, workspaceId, logicalRoute });
}

export function isLogicalRouteAdminRequest(request) {
  const url = new URL(request.url);
  return url.pathname === '/api/v1/admin/logical-routes'
    || url.pathname === '/api/v1/admin/logical-routes/reconcile';
}

export async function handleV1AdminLogicalRoutesRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  authorizeFn = authorizeV1AdminRequest,
} = {}) {
  if (!isLogicalRouteAdminRequest(request)) return null;
  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503); }
  const authorization = await authorizeFn(request, env, { supabase });
  if (!authorization?.ok) return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);

  const url = new URL(request.url);
  if (url.pathname === '/api/v1/admin/logical-routes' && request.method === 'GET') {
    if (!permission(authorization, 'sources.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    try {
      return json({ ok: true, workspaceId: String(authorization.workspace.id), logicalRoutes: await listLogicalRoutes(supabase, String(authorization.workspace.id)) });
    } catch {
      return json({ ok: false, reason: 'LOGICAL_ROUTE_LIST_FAILED' }, 503);
    }
  }

  if (url.pathname === '/api/v1/admin/logical-routes/reconcile' && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
    if (!permission(authorization, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    return reconcileLogicalRoute(request, authorization, supabase);
  }

  return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
}
