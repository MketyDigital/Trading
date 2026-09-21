import { repairLivePositionGroup } from '../execution/live_group_repair.js';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function secretFrom(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return String(request.headers.get('X-Mkety-Admin-Secret') || '').trim();
}

function authorize(request, env = {}) {
  const expected = String(env.MKETY_TRADING_ADMIN_SECRET || env.TRADING_ADMIN_SECRET || '').trim();
  if (!expected) return { ok: false, status: 503, reason: 'MKETY_ADMIN_SECRET_NOT_CONFIGURED' };
  const provided = secretFrom(request);
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
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return null;
  }
}

export async function handleMketyAdminTradeRepairRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  repairFn = repairLivePositionGroup,
} = {}) {
  const auth = authorize(request, env);
  if (!auth.ok) return json({ ok: false, reason: auth.reason }, auth.status);
  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });

  const match = new URL(request.url).pathname.match(/^\/api\/v1\/mkety-admin\/trade-repair\/([^/]+)$/);
  if (!match) return json({ ok: false, reason: 'MKETY_ADMIN_ROUTE_NOT_FOUND' }, 404);

  let groupId;
  try { groupId = decodeURIComponent(match[1]); }
  catch { return json({ ok: false, reason: 'INVALID_GROUP_ID' }, 400); }

  const body = await readJson(request);
  if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const workspaceId = String(body.workspaceId || body.workspace_id || '').trim();
  if (!workspaceId || !groupId) return json({ ok: false, reason: 'WORKSPACE_AND_GROUP_REQUIRED' }, 400);
  if (body.confirmLive !== true) return json({ ok: false, reason: 'LIVE_CONFIRMATION_REQUIRED' }, 409);

  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'MKETY_ADMIN_DATABASE_UNAVAILABLE' }, 503); }

  try {
    const result = await repairFn({ env, supabase, workspaceId, groupId, confirmLive: true });
    const status = result?.ok === true ? 200
      : result?.reason === 'SIGNAL_STOP_ALREADY_INVALIDATED' ? 409
      : result?.reason?.includes('NOT_FOUND') ? 404
      : 409;
    return json(result, status);
  } catch (error) {
    return json({
      ok: false,
      reason: String(error?.message || 'LIVE_GROUP_REPAIR_FAILED'),
      ...(error?.result ? { execution: error.result } : {}),
    }, 503);
  }
}
