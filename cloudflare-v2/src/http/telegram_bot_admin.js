import { authorizeV1AdminRequest } from './v1_admin.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { canUseSourceProvider } from '../security/trading_entitlements.js';
import { encryptConnectionCredentials, decryptConnectionCredentials, validateConnectionCredentials } from '../security/connection_credentials.js';
import { encryptSecret, decryptSecret } from '../security/secret_box.js';

const BOT_PROVIDER = 'telegram_bot_api';
const BOT_FAMILY = 'telegram';
const BOT_SOURCE_TYPE = 'telegram_bot';
const SOURCE_SELECT = 'id,workspace_id,source_type,source_instance_id,display_name,is_active,source_family,provider_type,is_default,priority,external_identity,public_source_handle,config,provider_secret_ciphertext,secret_ciphertext,health_status,last_error_code';

function text(value) { return String(value ?? '').trim(); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function randomHex(bytesLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function canonicalOrigin(env = {}) {
  const configured = String(env.TRADING_CANONICAL_HOSTS ?? '').split(',').map((v) => v.trim()).filter(Boolean)[0];
  const host = (configured || 'trade.mkety.com').replace(/^https?:\/\//i, '').split('/')[0];
  return `https://${host}`;
}
function safeSource(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    providerType: row.provider_type,
    sourceFamily: row.source_family,
    sourceType: row.source_type,
    sourceInstanceId: row.source_instance_id,
    displayName: row.display_name ?? null,
    externalIdentity: row.external_identity ?? null,
    publicSourceHandle: row.public_source_handle ?? null,
    webhookPath: row.public_source_handle ? `/api/v1/webhooks/telegram-bot/${encodeURIComponent(row.public_source_handle)}` : null,
    config: row.config || {},
    enabled: row.is_active === true,
    credentialConfigured: Boolean(row.provider_secret_ciphertext),
    credentialsConfigured: Boolean(row.provider_secret_ciphertext),
    health: { status: row.health_status ?? (row.is_active ? 'STARTING' : 'DISABLED'), lastErrorCode: row.last_error_code ?? null },
  };
}
async function readBody(request) {
  try {
    const value = await request.clone().json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
async function defaultSupabaseFactory(env = {}) {
  const url = text(env.SUPABASE_URL);
  const key = text(env.SUPABASE_SERVICE_ROLE ?? env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_KEY);
  if (!url || !key) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function sourceById(supabase, workspaceId, sourceId) {
  const { data, error } = await supabase.from('source_connections').select(SOURCE_SELECT).eq('workspace_id', workspaceId).eq('id', sourceId).maybeSingle();
  if (error) throw new Error('SOURCE_READ_FAILED');
  return data || null;
}
async function telegramApi(botToken, method, payload = {}, fetchFn = globalThis.fetch, timeoutMs = 5000) {
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'TELEGRAM_TRANSPORT_UNAVAILABLE' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, Math.min(10000, Number(timeoutMs) || 5000)));
  try {
    const response = await fetchFn(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) return { ok: false, reason: 'TELEGRAM_WEBHOOK_REGISTRATION_FAILED' };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.name === 'AbortError' ? 'TELEGRAM_WEBHOOK_REGISTRATION_TIMEOUT' : 'TELEGRAM_WEBHOOK_REGISTRATION_FAILED' };
  } finally { clearTimeout(timer); }
}

export async function handleTelegramBotAdminRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  authorizeFn = authorizeV1AdminRequest,
  fetchFn = globalThis.fetch,
  encryptCredentials = encryptConnectionCredentials,
  decryptCredentials = decryptConnectionCredentials,
  encryptIngressSecret = encryptSecret,
  decryptIngressSecret = decryptSecret,
  generateHandle = () => randomHex(18),
  generateWebhookSecret = () => randomHex(24),
} = {}) {
  const url = new URL(request.url);
  const createRoute = url.pathname === '/api/v1/admin/sources' && request.method === 'POST';
  const actionMatch = url.pathname.match(/^\/api\/v1\/admin\/sources\/([^/]+)\/(enable|disable|credentials)$/);
  if (!createRoute && !actionMatch) return null;

  let createBody = null;
  if (createRoute) {
    createBody = await readBody(request);
    if (!createBody || text(createBody.providerType ?? createBody.provider_type) !== BOT_PROVIDER) return null;
  }

  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503); }
  const authorization = await authorizeFn(request, env, { supabase });
  if (!authorization?.ok) return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);
  if (!hasTradingPermission(authorization.membership?.role, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  const workspaceId = text(authorization.workspace?.id);
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!env.TRADING_MASTER_KEY) return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503);

  if (createRoute) {
    if (!canUseSourceProvider(authorization, { sourceFamily: BOT_FAMILY, providerType: BOT_PROVIDER })) {
      return json({ ok: false, reason: 'TRADING_SOURCE_ENTITLEMENT_REQUIRED' }, 403);
    }
    const sourceFamily = text(createBody.sourceFamily ?? createBody.source_family);
    const sourceType = text(createBody.sourceType ?? createBody.source_type);
    const sourceInstanceId = text(createBody.sourceInstanceId ?? createBody.source_instance_id);
    const config = createBody.config && typeof createBody.config === 'object' && !Array.isArray(createBody.config) ? createBody.config : {};
    const chatIds = Array.isArray(config.chat_ids) ? [...new Set(config.chat_ids.map(text).filter(Boolean))] : [];
    if (sourceFamily !== BOT_FAMILY || sourceType !== BOT_SOURCE_TYPE || !sourceInstanceId || chatIds.length === 0) {
      return json({ ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' }, 400);
    }
    let credentials;
    try { credentials = validateConnectionCredentials('telegram_bot', createBody.credentials); }
    catch { return json({ ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' }, 400); }

    let providerCiphertext;
    let ingressCiphertext;
    const publicHandle = text(generateHandle());
    const webhookSecret = text(generateWebhookSecret());
    if (!publicHandle || !webhookSecret) return json({ ok: false, reason: 'SOURCE_CREATE_FAILED' }, 503);
    try {
      [providerCiphertext, ingressCiphertext] = await Promise.all([
        encryptCredentials('telegram_bot', credentials, env.TRADING_MASTER_KEY),
        encryptIngressSecret(webhookSecret, env.TRADING_MASTER_KEY),
      ]);
    } catch { return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503); }

    const row = {
      workspace_id: workspaceId,
      source_type: BOT_SOURCE_TYPE,
      source_instance_id: sourceInstanceId,
      display_name: text(createBody.displayName ?? createBody.display_name) || sourceInstanceId,
      secret_ciphertext: ingressCiphertext,
      settings: {},
      is_active: false,
      source_family: BOT_FAMILY,
      provider_type: BOT_PROVIDER,
      is_default: false,
      priority: Number.isFinite(Number(createBody.priority)) ? Number(createBody.priority) : 0,
      external_identity: text(createBody.externalIdentity ?? createBody.external_identity) || sourceInstanceId,
      public_source_handle: publicHandle,
      config: { chat_ids: chatIds },
      provider_secret_ciphertext: providerCiphertext,
      health_status: 'DISABLED',
    };
    const { data, error } = await supabase.from('source_connections').insert(row).select(SOURCE_SELECT).maybeSingle();
    if (error || !data) return json({ ok: false, reason: 'SOURCE_CREATE_FAILED' }, 503);
    return json({ ok: true, workspaceId, source: safeSource(data) }, 201);
  }

  let sourceId;
  try { sourceId = decodeURIComponent(actionMatch[1]); }
  catch { return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404); }
  const action = actionMatch[2];
  let source;
  try { source = await sourceById(supabase, workspaceId, sourceId); }
  catch { return json({ ok: false, reason: 'SOURCE_READ_FAILED' }, 503); }
  if (!source || source.provider_type !== BOT_PROVIDER) return null;
  if (!canUseSourceProvider(authorization, { sourceFamily: BOT_FAMILY, providerType: BOT_PROVIDER })) {
    return json({ ok: false, reason: 'TRADING_SOURCE_ENTITLEMENT_REQUIRED' }, 403);
  }

  if (action === 'credentials') {
    if (request.method !== 'PUT') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
    if (source.is_active) return json({ ok: false, reason: 'DISCONNECT_SOURCE_BEFORE_CREDENTIAL_CHANGE' }, 409);
    const body = await readBody(request);
    let credentials;
    try { credentials = validateConnectionCredentials('telegram_bot', body?.credentials); }
    catch { return json({ ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' }, 400); }
    let ciphertext;
    try { ciphertext = await encryptCredentials('telegram_bot', credentials, env.TRADING_MASTER_KEY); }
    catch { return json({ ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' }, 400); }
    const { data, error } = await supabase.from('source_connections').update({ provider_secret_ciphertext: ciphertext, health_status: 'DISABLED', last_error_code: null }).eq('workspace_id', workspaceId).eq('id', sourceId).select(SOURCE_SELECT).maybeSingle();
    if (error || !data) return json({ ok: false, reason: 'SOURCE_CREDENTIAL_REPLACE_FAILED' }, 503);
    return json({ ok: true, workspaceId, source: safeSource(data) });
  }

  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);

  if (action === 'disable') {
    const { data, error } = await supabase.from('source_connections').update({ is_active: false, is_default: false, health_status: 'DISABLED' }).eq('workspace_id', workspaceId).eq('id', sourceId).select(SOURCE_SELECT).maybeSingle();
    if (error || !data) return json({ ok: false, reason: 'SOURCE_STATE_UPDATE_FAILED' }, 503);
    try {
      const credentials = await decryptCredentials('telegram_bot', source.provider_secret_ciphertext, env.TRADING_MASTER_KEY);
      await telegramApi(credentials.botToken, 'deleteWebhook', { drop_pending_updates: false }, fetchFn, 2500);
    } catch {
      // DB disable is authoritative. Telegram cleanup is best-effort and must not
      // turn a successfully disabled source back into an operational failure.
    }
    return json({ ok: true, workspaceId, source: safeSource(data) });
  }

  const chatIds = Array.isArray(source.config?.chat_ids) ? source.config.chat_ids.map(text).filter(Boolean) : [];
  if (!source.public_source_handle || !source.secret_ciphertext || !source.provider_secret_ciphertext || chatIds.length === 0) {
    return json({ ok: false, reason: 'SOURCE_NOT_READY' }, 409);
  }
  let botCredentials;
  let webhookSecret;
  try {
    [botCredentials, webhookSecret] = await Promise.all([
      decryptCredentials('telegram_bot', source.provider_secret_ciphertext, env.TRADING_MASTER_KEY),
      decryptIngressSecret(source.secret_ciphertext, env.TRADING_MASTER_KEY),
    ]);
  } catch { return json({ ok: false, reason: 'SOURCE_NOT_READY' }, 409); }
  const registered = await telegramApi(botCredentials.botToken, 'setWebhook', {
    url: `${canonicalOrigin(env)}/api/v1/webhooks/telegram-bot/${encodeURIComponent(source.public_source_handle)}`,
    secret_token: webhookSecret,
    allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
    drop_pending_updates: false,
  }, fetchFn, 5000);
  if (!registered.ok) {
    await supabase.from('source_connections').update({ is_active: false, health_status: 'DEGRADED', last_error_code: registered.reason }).eq('workspace_id', workspaceId).eq('id', sourceId);
    return json({ ok: false, reason: registered.reason }, 503);
  }
  const { data, error } = await supabase.from('source_connections').update({ is_active: true, health_status: 'HEALTHY', last_error_code: null, last_connected_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', sourceId).select(SOURCE_SELECT).maybeSingle();
  if (error || !data) return json({ ok: false, reason: 'SOURCE_STATE_UPDATE_FAILED' }, 503);
  return json({ ok: true, workspaceId, source: safeSource(data) });
}
