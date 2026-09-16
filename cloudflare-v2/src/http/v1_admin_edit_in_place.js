import { authorizeV1AdminRequest } from './v1_admin.js';
import { hasTradingPermission } from '../security/trading_permissions.js';

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
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

function canWrite(authorization) {
  return hasTradingPermission(authorization?.membership?.role, 'sources.write');
}

function sanitizeConfigValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeConfigValue);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(secret|cipher|session|token|password|api[_-]?hash|api[_-]?key|credential|authorization|private[_-]?key)/i.test(key)) continue;
    output[key] = sanitizeConfigValue(item);
  }
  return output;
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

function validateSourceConfig(providerType, config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' };
  const safe = sanitizeConfigValue(config);
  if (providerType === 'external_mtproto') {
    const mode = text(safe.chat_acceptance_mode) || 'allowlist';
    if (!['allowlist', 'all_visible'].includes(mode)) return { ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' };
    const ids = normalizeIds(safe.allowed_chat_ids ?? []);
    if (ids === null) return { ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' };
    if (mode === 'allowlist' && ids.length === 0) return { ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' };
    return { ok: true, config: { ...safe, chat_acceptance_mode: mode, allowed_chat_ids: ids } };
  }
  if (['cloudflare_container_mtproto', 'cloudflare_do_mtproto'].includes(providerType)) {
    const ids = normalizeIds(safe.chat_ids ?? []);
    if (ids === null || ids.length === 0) return { ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' };
    return { ok: true, config: { ...safe, chat_ids: ids } };
  }
  if (providerType === 'telegram_bot_api') {
    const key = hasOwn(safe, 'allowed_chat_ids') ? 'allowed_chat_ids' : 'chat_ids';
    const ids = normalizeIds(safe[key] ?? []);
    if (ids === null || ids.length === 0) return { ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' };
    return { ok: true, config: { ...safe, [key]: ids } };
  }
  return { ok: true, config: safe };
}

function desiredFeedIds(providerType, config = {}) {
  if (providerType === 'external_mtproto') {
    if ((text(config.chat_acceptance_mode) || 'allowlist') === 'all_visible') return null;
    return normalizeIds(config.allowed_chat_ids ?? []) || [];
  }
  if (['cloudflare_container_mtproto', 'cloudflare_do_mtproto'].includes(providerType)) {
    return normalizeIds(config.chat_ids ?? []) || [];
  }
  if (providerType === 'telegram_bot_api') {
    return normalizeIds(config.allowed_chat_ids ?? config.chat_ids ?? []) || [];
  }
  return null;
}

async function reconcileTelegramFeeds(supabase, workspaceId, sourceId, providerType, config) {
  const desired = desiredFeedIds(providerType, config);
  if (desired === null) return;
  if (desired.length) {
    const rows = desired.map((providerFeedId) => ({
      workspace_id: workspaceId,
      source_connection_id: sourceId,
      provider_feed_id: providerFeedId,
      feed_type: 'telegram_chat',
      is_active: true,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('source_feeds').upsert(rows, {
      onConflict: 'workspace_id,source_connection_id,provider_feed_id',
    });
    if (error) throw new Error('SOURCE_FEED_RECONCILE_FAILED');
  }
  const { data: existing, error: readError } = await supabase
    .from('source_feeds')
    .select('id,provider_feed_id,is_active')
    .eq('workspace_id', workspaceId)
    .eq('source_connection_id', sourceId);
  if (readError) throw new Error('SOURCE_FEED_RECONCILE_FAILED');
  const wanted = new Set(desired);
  const deactivate = (existing || []).filter((row) => !wanted.has(text(row.provider_feed_id))).map((row) => row.id);
  if (deactivate.length) {
    const { error } = await supabase.from('source_feeds')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .in('id', deactivate);
    if (error) throw new Error('SOURCE_FEED_RECONCILE_FAILED');
  }
}

function sourcePublic(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    providerType: row.provider_type,
    sourceFamily: row.source_family,
    sourceType: row.source_type,
    sourceInstanceId: row.source_instance_id,
    displayName: row.display_name ?? null,
    externalIdentity: row.external_identity ?? null,
    priority: Number(row.priority || 0),
    config: safeObject(row.config),
    enabled: Boolean(row.is_active),
  };
}

function feedPublic(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceConnectionId: row.source_connection_id,
    providerFeedId: row.provider_feed_id,
    displayName: row.display_name ?? null,
    feedType: row.feed_type,
    isActive: Boolean(row.is_active),
    metadata: safeObject(row.metadata),
  };
}

function destinationPublic(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    destinationType: row.destination_type,
    displayName: row.display_name,
    destinationRef: row.destination_ref ?? null,
    templateId: row.template_id ?? null,
    credentialConnectionId: row.credential_connection_id ?? null,
    settings: safeObject(row.settings),
    enabled: Boolean(row.is_active),
    healthStatus: row.health_status ?? null,
    credentialConfigured: Boolean(row.credential_ciphertext || row.credential_connection_id),
  };
}

function templatePublic(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    templateName: row.template_name,
    formattingMode: row.formatting_mode,
    parseMode: row.parse_mode,
    brandName: row.brand_name ?? null,
    header: row.header ?? null,
    footer: row.footer ?? null,
    disclaimer: row.disclaimer ?? null,
    emojiStyle: row.emoji_style ?? null,
    cleanupRules: safeObject(row.cleanup_rules),
    layout: safeObject(row.layout),
    isDefault: Boolean(row.is_default),
  };
}

function routePublic(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceConnectionId: row.source_connection_id,
    sourceFeedId: row.source_feed_id ?? null,
    destinationId: row.destination_id,
    routeName: row.route_name ?? null,
    priority: Number(row.priority ?? 100),
    enabled: Boolean(row.is_active),
    filters: safeObject(row.filters),
  };
}

function connectionPublic(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    providerType: row.provider_type,
    displayName: row.display_name,
    enabled: Boolean(row.is_active),
    credentialConfigured: Boolean(row.credential_ciphertext),
  };
}

function normalizeCanonicalSymbols(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('ROUTE_FILTERS_INVALID');
  return [...new Set(value.map((item) => String(item ?? '').trim().toUpperCase()).filter(Boolean))];
}

function normalizeRouteFilters(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ROUTE_FILTERS_INVALID');
  const result = { ...value };
  const allowed = normalizeCanonicalSymbols(value.allowedCanonicalSymbols ?? value.allowed_canonical_symbols);
  const blocked = normalizeCanonicalSymbols(value.blockedCanonicalSymbols ?? value.blocked_canonical_symbols);
  if (allowed !== undefined) {
    result.allowedCanonicalSymbols = allowed;
    delete result.allowed_canonical_symbols;
  }
  if (blocked !== undefined) {
    result.blockedCanonicalSymbols = blocked;
    delete result.blocked_canonical_symbols;
  }
  return result;
}

async function updateSource(request, authorization, supabase, sourceId) {
  const workspaceId = String(authorization.workspace.id);
  const body = await readJson(request);
  if (!body) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const { data: current, error: readError } = await supabase.from('source_connections').select('*')
    .eq('workspace_id', workspaceId).eq('id', sourceId).maybeSingle();
  if (readError) return json({ ok: false, reason: 'SOURCE_READ_FAILED' }, 503);
  if (!current) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);

  const patch = { updated_at: new Date().toISOString() };
  if (hasOwn(body, 'displayName') || hasOwn(body, 'display_name')) {
    const value = text(body.displayName ?? body.display_name);
    if (!value) return json({ ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' }, 400);
    patch.display_name = value;
  }
  if (hasOwn(body, 'priority')) {
    const value = Number(body.priority);
    if (!Number.isFinite(value)) return json({ ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' }, 400);
    patch.priority = value;
  }
  if (hasOwn(body, 'externalIdentity') || hasOwn(body, 'external_identity')) {
    patch.external_identity = text(body.externalIdentity ?? body.external_identity);
  }
  if (hasOwn(body, 'config')) {
    const parsed = validateSourceConfig(current.provider_type, body.config);
    if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
    patch.config = parsed.config;
  }

  const { data: updated, error } = await supabase.from('source_connections').update(patch)
    .eq('workspace_id', workspaceId).eq('id', sourceId).select('*').maybeSingle();
  if (error || !updated) return json({ ok: false, reason: 'SOURCE_UPDATE_FAILED' }, 503);
  if (hasOwn(patch, 'config') && updated.source_family === 'telegram') {
    try { await reconcileTelegramFeeds(supabase, workspaceId, sourceId, updated.provider_type, updated.config || {}); }
    catch { return json({ ok: false, reason: 'SOURCE_FEED_RECONCILE_FAILED' }, 503); }
  }
  return json({ ok: true, workspaceId, source: sourcePublic(updated) });
}

async function updateFeed(request, authorization, supabase, sourceId, feedId) {
  const workspaceId = String(authorization.workspace.id);
  const body = await readJson(request);
  if (!body) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const patch = { updated_at: new Date().toISOString() };
  if (hasOwn(body, 'displayName') || hasOwn(body, 'display_name')) patch.display_name = text(body.displayName ?? body.display_name);
  if (hasOwn(body, 'enabled') || hasOwn(body, 'isActive') || hasOwn(body, 'is_active')) {
    patch.is_active = Boolean(body.enabled ?? body.isActive ?? body.is_active);
  }
  const { data, error } = await supabase.from('source_feeds').update(patch)
    .eq('workspace_id', workspaceId).eq('source_connection_id', sourceId).eq('id', feedId)
    .select('*').maybeSingle();
  if (error) return json({ ok: false, reason: 'SOURCE_FEED_UPDATE_FAILED' }, 503);
  if (!data) return json({ ok: false, reason: 'SOURCE_FEED_NOT_FOUND' }, 404);
  return json({ ok: true, workspaceId, feed: feedPublic(data) });
}

async function updateDestination(request, authorization, supabase, id) {
  const workspaceId = String(authorization.workspace.id);
  const body = await readJson(request);
  if (!body) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const { data: current, error: readError } = await supabase.from('trading_destinations').select('*')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  if (readError) return json({ ok: false, reason: 'DESTINATION_READ_FAILED' }, 503);
  if (!current) return json({ ok: false, reason: 'DESTINATION_NOT_FOUND' }, 404);
  const patch = { updated_at: new Date().toISOString() };
  if (hasOwn(body, 'displayName') || hasOwn(body, 'display_name')) {
    const value = text(body.displayName ?? body.display_name);
    if (!value) return json({ ok: false, reason: 'DESTINATION_NAME_REQUIRED' }, 400);
    patch.display_name = value;
  }
  if (hasOwn(body, 'destinationRef') || hasOwn(body, 'destination_ref')) patch.destination_ref = text(body.destinationRef ?? body.destination_ref);
  if (hasOwn(body, 'templateId') || hasOwn(body, 'template_id')) patch.template_id = text(body.templateId ?? body.template_id);
  if (hasOwn(body, 'credentialConnectionId') || hasOwn(body, 'credential_connection_id')) patch.credential_connection_id = text(body.credentialConnectionId ?? body.credential_connection_id);
  if (hasOwn(body, 'settings')) {
    if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) return json({ ok: false, reason: 'DESTINATION_SETTINGS_INVALID' }, 400);
    patch.settings = body.settings;
  }
  const effectiveRef = hasOwn(patch, 'destination_ref') ? patch.destination_ref : current.destination_ref;
  if (current.destination_type !== 'audit_only' && !effectiveRef) return json({ ok: false, reason: 'DESTINATION_REF_REQUIRED' }, 400);
  const { data, error } = await supabase.from('trading_destinations').update(patch)
    .eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle();
  if (error) return json({ ok: false, reason: 'DESTINATION_UPDATE_FAILED' }, 503);
  return json({ ok: true, workspaceId, destination: destinationPublic(data) });
}

async function updateTemplate(request, authorization, supabase, id) {
  const workspaceId = String(authorization.workspace.id);
  const body = await readJson(request);
  if (!body) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const { data: current, error: readError } = await supabase.from('trading_destination_templates').select('*')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  if (readError) return json({ ok: false, reason: 'TEMPLATE_READ_FAILED' }, 503);
  if (!current) return json({ ok: false, reason: 'TEMPLATE_NOT_FOUND' }, 404);
  const patch = { updated_at: new Date().toISOString() };
  const map = [
    ['templateName', 'template_name'], ['formattingMode', 'formatting_mode'], ['parseMode', 'parse_mode'],
    ['brandName', 'brand_name'], ['header', 'header'], ['footer', 'footer'], ['disclaimer', 'disclaimer'], ['emojiStyle', 'emoji_style'],
  ];
  for (const [camel, snake] of map) if (hasOwn(body, camel) || hasOwn(body, snake)) patch[snake] = text(body[camel] ?? body[snake]);
  if (hasOwn(patch, 'template_name') && !patch.template_name) return json({ ok: false, reason: 'TEMPLATE_NAME_REQUIRED' }, 400);
  const format = patch.formatting_mode ?? current.formatting_mode;
  if (!['none', 'clean', 'template', 'ai_then_fallback'].includes(format)) return json({ ok: false, reason: 'FORMAT_MODE_UNSUPPORTED' }, 400);
  const parseMode = patch.parse_mode ?? current.parse_mode;
  if (!['HTML', 'Markdown', 'MarkdownV2', 'plain'].includes(parseMode)) return json({ ok: false, reason: 'PARSE_MODE_UNSUPPORTED' }, 400);
  if (hasOwn(body, 'cleanupRules') || hasOwn(body, 'cleanup_rules')) patch.cleanup_rules = safeObject(body.cleanupRules ?? body.cleanup_rules);
  if (hasOwn(body, 'layout')) patch.layout = safeObject(body.layout);
  if (hasOwn(body, 'isDefault') || hasOwn(body, 'is_default')) patch.is_default = Boolean(body.isDefault ?? body.is_default);
  const { data, error } = await supabase.from('trading_destination_templates').update(patch)
    .eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle();
  if (error) return json({ ok: false, reason: 'TEMPLATE_UPDATE_FAILED' }, 503);
  return json({ ok: true, workspaceId, template: templatePublic(data) });
}

async function updateRoute(request, authorization, supabase, id) {
  const workspaceId = String(authorization.workspace.id);
  const body = await readJson(request);
  if (!body) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const { data: current, error: readError } = await supabase.from('source_destination_routes').select('*')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  if (readError) return json({ ok: false, reason: 'ROUTE_READ_FAILED' }, 503);
  if (!current) return json({ ok: false, reason: 'ROUTE_NOT_FOUND' }, 404);
  const patch = { updated_at: new Date().toISOString() };
  if (hasOwn(body, 'sourceConnectionId') || hasOwn(body, 'source_connection_id')) {
    patch.source_connection_id = text(body.sourceConnectionId ?? body.source_connection_id);
    if (!patch.source_connection_id) return json({ ok: false, reason: 'SOURCE_CONNECTION_REQUIRED' }, 400);
  }
  if (hasOwn(body, 'sourceFeedId') || hasOwn(body, 'source_feed_id')) patch.source_feed_id = text(body.sourceFeedId ?? body.source_feed_id);
  if (hasOwn(body, 'destinationId') || hasOwn(body, 'destination_id')) {
    patch.destination_id = text(body.destinationId ?? body.destination_id);
    if (!patch.destination_id) return json({ ok: false, reason: 'DESTINATION_REQUIRED' }, 400);
  }
  if (hasOwn(body, 'routeName') || hasOwn(body, 'route_name')) patch.route_name = text(body.routeName ?? body.route_name);
  if (hasOwn(body, 'priority')) {
    patch.priority = Number(body.priority);
    if (!Number.isFinite(patch.priority)) return json({ ok: false, reason: 'ROUTE_PRIORITY_INVALID' }, 400);
  }
  if (hasOwn(body, 'filters')) {
    try { patch.filters = normalizeRouteFilters(body.filters); }
    catch { return json({ ok: false, reason: 'ROUTE_FILTERS_INVALID' }, 400); }
  }
  const { data, error } = await supabase.from('source_destination_routes').update(patch)
    .eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle();
  if (error) return json({ ok: false, reason: 'ROUTE_UPDATE_FAILED' }, 409);
  return json({ ok: true, workspaceId, route: routePublic(data) });
}

async function updateDestinationConnection(request, authorization, supabase, id) {
  const workspaceId = String(authorization.workspace.id);
  const body = await readJson(request);
  if (!body) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const patch = { updated_at: new Date().toISOString() };
  if (hasOwn(body, 'displayName') || hasOwn(body, 'display_name')) {
    const value = text(body.displayName ?? body.display_name);
    if (!value) return json({ ok: false, reason: 'DESTINATION_CONNECTION_NAME_REQUIRED' }, 400);
    patch.display_name = value;
  }
  if (hasOwn(body, 'enabled') || hasOwn(body, 'isActive') || hasOwn(body, 'is_active')) patch.is_active = Boolean(body.enabled ?? body.isActive ?? body.is_active);
  const { data, error } = await supabase.from('trading_destination_connections').update(patch)
    .eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle();
  if (error) return json({ ok: false, reason: 'DESTINATION_CONNECTION_UPDATE_FAILED' }, 503);
  if (!data) return json({ ok: false, reason: 'DESTINATION_CONNECTION_NOT_FOUND' }, 404);
  return json({ ok: true, workspaceId, destinationConnection: connectionPublic(data) });
}

export function isEditInPlaceAdminRequest(request) {
  const url = new URL(request.url);
  if (!['PUT', 'PATCH'].includes(request.method)) return false;
  return [
    /^\/api\/v1\/admin\/sources\/[^/]+$/,
    /^\/api\/v1\/admin\/sources\/[^/]+\/feeds\/[^/]+$/,
    /^\/api\/v1\/admin\/routes\/[^/]+$/,
    /^\/api\/v1\/admin\/destinations\/[^/]+$/,
    /^\/api\/v1\/admin\/templates\/[^/]+$/,
    /^\/api\/v1\/admin\/destination-connections\/[^/]+$/,
  ].some((pattern) => pattern.test(url.pathname));
}

export async function handleV1AdminEditInPlaceRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  authorizeFn = authorizeV1AdminRequest,
} = {}) {
  if (!isEditInPlaceAdminRequest(request)) return null;
  let supabase;
  try { supabase = await supabaseFactory(env); }
  catch { return json({ ok: false, reason: 'ADMIN_DATABASE_UNAVAILABLE' }, 503); }
  const authorization = await authorizeFn(request, env, { supabase });
  if (!authorization?.ok) return json({ ok: false, reason: authorization?.reason || 'ADMIN_FORBIDDEN' }, authorization?.status || 403);
  if (!canWrite(authorization)) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  const path = new URL(request.url).pathname;
  let match;
  if ((match = path.match(/^\/api\/v1\/admin\/sources\/([^/]+)\/feeds\/([^/]+)$/))) {
    return updateFeed(request, authorization, supabase, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
  }
  if ((match = path.match(/^\/api\/v1\/admin\/sources\/([^/]+)$/))) {
    return updateSource(request, authorization, supabase, decodeURIComponent(match[1]));
  }
  if ((match = path.match(/^\/api\/v1\/admin\/routes\/([^/]+)$/))) {
    return updateRoute(request, authorization, supabase, decodeURIComponent(match[1]));
  }
  if ((match = path.match(/^\/api\/v1\/admin\/destinations\/([^/]+)$/))) {
    return updateDestination(request, authorization, supabase, decodeURIComponent(match[1]));
  }
  if ((match = path.match(/^\/api\/v1\/admin\/templates\/([^/]+)$/))) {
    return updateTemplate(request, authorization, supabase, decodeURIComponent(match[1]));
  }
  if ((match = path.match(/^\/api\/v1\/admin\/destination-connections\/([^/]+)$/))) {
    return updateDestinationConnection(request, authorization, supabase, decodeURIComponent(match[1]));
  }
  return null;
}
