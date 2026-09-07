import {
  createLocalTradingBearer,
  normalizeTradingAccessCode,
} from '../access/trading_access_codes.js';
import { createTradingAccessCodeStore } from '../persistence/supabase_access_code_store.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
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

export async function handleTradingAccessCodeRedeemRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  storeFactory = createTradingAccessCodeStore,
  now = new Date(),
  nowSec = Math.floor(Date.now() / 1000),
} = {}) {
  if (!enabled(env.TRADING_ACCESS_CODE_REDEMPTION_ENABLED)) {
    return json({ ok: false, reason: 'ACCESS_CODE_REDEMPTION_DISABLED' }, 503);
  }
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  }
  if (!env.TRADING_ACCESS_CODE_SESSION_SECRET) {
    return json({ ok: false, reason: 'ACCESS_CODE_SESSION_NOT_CONFIGURED' }, 503);
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
    const supabase = await supabaseFactory(env);
    store = storeFactory(supabase, env);
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

  const bearer = await createLocalTradingBearer({
    subject: result.membership.subject,
    workspaceId: result.workspace.id,
    access: 'owner',
  }, env.TRADING_ACCESS_CODE_SESSION_SECRET, nowSec);

  return json({
    ok: true,
    mode: 'access_code_onboarding',
    workspace: result.workspace,
    membership: {
      role: result.membership.role,
      enabled: true,
    },
    entitlements: result.entitlements,
    brokerExecutionEnabled: enabled(env.BROKER_EXECUTION_ENABLED),
    bearer,
  });
}
