import {
  clearTradingRefreshCookie,
  createLocalTradingBearer,
  createTradingRefreshToken,
  normalizeTradingAccessCode,
  readTradingRefreshCookie,
  tradingRefreshCookie,
  verifyTradingRefreshToken,
} from '../access/trading_access_codes.js';
import { createTradingAccessCodeStore } from '../persistence/supabase_access_code_store.js';

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

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

async function defaultSupabaseFactory(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function createStore(env, supabaseFactory, storeFactory) {
  const supabase = await supabaseFactory(env);
  return storeFactory(supabase, env);
}

async function issueSession(result, env, nowSec, mode, { includeRefreshCookie = false } = {}) {
  const bearer = await createLocalTradingBearer({
    subject: result.membership.subject,
    workspaceId: result.workspace.id,
    access: 'owner',
  }, env.TRADING_ACCESS_CODE_SESSION_SECRET, nowSec);

  const headers = {};
  if (includeRefreshCookie) {
    const refreshToken = await createTradingRefreshToken({
      subject: result.membership.subject,
      workspaceId: result.workspace.id,
    }, env.TRADING_ACCESS_CODE_SESSION_SECRET, nowSec);
    headers['Set-Cookie'] = tradingRefreshCookie(refreshToken);
  }

  return json({
    ok: true,
    mode,
    workspace: result.workspace,
    membership: {
      role: result.membership.role,
      enabled: true,
    },
    entitlements: result.entitlements,
    brokerExecutionEnabled: enabled(env.BROKER_EXECUTION_ENABLED),
    bearer,
  }, 200, headers);
}

export async function handleTradingAccessCodeRedeemRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  storeFactory = createTradingAccessCodeStore,
  now = new Date(),
  nowSec = Math.floor(Date.now() / 1000),
  refreshVerifier = verifyTradingRefreshToken,
} = {}) {
  const url = new URL(request.url);

  if (url.pathname === '/api/v1/access/logout') {
    if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
    return json({ ok: true }, 200, { 'Set-Cookie': clearTradingRefreshCookie() });
  }

  if (!env.TRADING_ACCESS_CODE_SESSION_SECRET) {
    return json({ ok: false, reason: 'ACCESS_CODE_SESSION_NOT_CONFIGURED' }, 503);
  }

  if (url.pathname === '/api/v1/access/session') {
    if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
    const refreshToken = readTradingRefreshCookie(request);
    if (!refreshToken) return json({ ok: false, reason: 'RETURNING_SESSION_NOT_FOUND' }, 401);
    const verified = await refreshVerifier(refreshToken, env.TRADING_ACCESS_CODE_SESSION_SECRET, { nowSec });
    if (!verified?.ok) {
      return json({ ok: false, reason: verified?.reason || 'RETURNING_SESSION_INVALID' }, 401, { 'Set-Cookie': clearTradingRefreshCookie() });
    }

    let store;
    try {
      store = await createStore(env, supabaseFactory, storeFactory);
    } catch {
      return json({ ok: false, reason: 'ACCESS_CODE_STORE_UNAVAILABLE' }, 503);
    }

    let result;
    try {
      result = await store.restoreSession({ workspaceId: verified.workspaceId, subject: verified.subject });
    } catch {
      return json({ ok: false, reason: 'RETURNING_SESSION_LOOKUP_FAILED' }, 503);
    }
    if (!result?.ok) {
      return json({ ok: false, reason: result?.reason || 'RETURNING_SESSION_DENIED' }, result?.status || 403, { 'Set-Cookie': clearTradingRefreshCookie() });
    }

    return issueSession(result, env, nowSec, 'returning_session', { includeRefreshCookie: true });
  }

  if (url.pathname !== '/api/v1/access/redeem') return json({ ok: false, reason: 'ACCESS_ROUTE_NOT_FOUND' }, 404);
  if (!enabled(env.TRADING_ACCESS_CODE_REDEMPTION_ENABLED)) {
    return json({ ok: false, reason: 'ACCESS_CODE_REDEMPTION_DISABLED' }, 503);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const body = await parseJson(request);
  if (!body || typeof body !== 'object') {
    return json({ ok: false, reason: 'INVALID_JSON_BODY' }, 400);
  }

  const normalizedCode = normalizeTradingAccessCode(body.code);
  const ownerEmail = String(body.ownerEmail ?? '').trim().toLowerCase();
  if (!normalizedCode) return json({ ok: false, reason: 'ACCESS_CODE_REQUIRED' }, 400);
  if (!ownerEmail || !ownerEmail.includes('@')) return json({ ok: false, reason: 'OWNER_EMAIL_REQUIRED' }, 400);

  let store;
  try {
    store = await createStore(env, supabaseFactory, storeFactory);
  } catch {
    return json({ ok: false, reason: 'ACCESS_CODE_STORE_UNAVAILABLE' }, 503);
  }

  let result;
  try {
    result = await store.redeem({
      normalizedCode,
      ownerEmail,
      ownerName: String(body.ownerName ?? '').trim() || null,
      workspaceName: String(body.workspaceName ?? '').trim() || null,
      requestedSubdomain: String(body.requestedSubdomain ?? '').trim().toLowerCase() || null,
      now,
    });
  } catch {
    return json({ ok: false, reason: 'ACCESS_CODE_REDEMPTION_FAILED' }, 503);
  }

  if (!result?.ok) {
    return json({ ok: false, reason: result?.reason || 'ACCESS_CODE_REDEMPTION_DENIED' }, result?.status || 403);
  }

  return issueSession(result, env, nowSec, result.mode || 'access_code_onboarding', { includeRefreshCookie: true });
}