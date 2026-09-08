import { createClient } from '@supabase/supabase-js';
import { authorizeV1AdminRequest } from './v1_admin.js';
import { createAdminSourceStore } from './v1_admin_sources.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { encryptSecret } from '../security/secret_box.js';

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

async function defaultSupabaseFactory(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  return createClient(url, key);
}

function randomSourceSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleV1AdminSourceIngressSecretRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  authorizeFn = authorizeV1AdminRequest,
  sourceStoreFactory = createAdminSourceStore,
  encryptFn = encryptSecret,
  generateSecret = randomSourceSecret,
} = {}) {
  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/v1\/admin\/sources\/([^/]+)\/ingress-secret$/);
  if (!match) return json({ ok: false, reason: 'ADMIN_SOURCE_ROUTE_NOT_FOUND' }, 404);

  let sourceId;
  try { sourceId = decodeURIComponent(match[1]); }
  catch { return json({ ok: false, reason: 'SOURCE_ID_INVALID' }, 400); }
  if (!String(sourceId || '').trim()) return json({ ok: false, reason: 'SOURCE_ID_INVALID' }, 400);

  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503); }

  const authorization = await authorizeFn(request, env, { supabase });
  if (!authorization?.ok) return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);
  if (!hasTradingPermission(authorization?.membership?.role, 'sources.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }
  if (!env.TRADING_MASTER_KEY) return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503);

  let sourceStore;
  try { sourceStore = sourceStoreFactory(supabase, env); }
  catch { return json({ ok: false, reason: 'SOURCE_STORE_UNAVAILABLE' }, 503); }

  const workspaceId = String(authorization?.workspace?.id || '').trim();
  let source;
  try { source = await sourceStore.getSource(workspaceId, sourceId); }
  catch { return json({ ok: false, reason: 'SOURCE_READ_FAILED' }, 503); }
  if (!source) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);
  if (source.providerType !== 'external_mtproto' && source.providerType !== 'custom_signed_api') {
    return json({ ok: false, reason: 'SOURCE_INGRESS_SECRET_NOT_APPLICABLE' }, 400);
  }

  let secret;
  let ciphertext;
  try {
    secret = String(generateSecret());
    if (!secret) throw new Error('empty secret');
    ciphertext = await encryptFn(secret, env.TRADING_MASTER_KEY);
  } catch {
    return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503);
  }

  try {
    const updated = await sourceStore.replaceIngressSecret(workspaceId, sourceId, ciphertext);
    if (!updated) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);
  } catch {
    return json({ ok: false, reason: 'SOURCE_INGRESS_SECRET_REPLACE_FAILED' }, 503);
  }

  return json({
    ok: true,
    workspaceId,
    sourceId: String(sourceId),
    oneTimeSigningSecret: secret,
  });
}
