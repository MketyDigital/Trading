import { normalizeProviderRecord } from '../sources/provider_registry.js';
import { hasTradingPermission } from '../security/trading_permissions.js';

const SOURCE_SELECT = [
  'id', 'workspace_id', 'source_type', 'source_instance_id', 'display_name', 'is_active',
  'source_family', 'provider_type', 'is_default', 'priority', 'external_identity', 'config',
  'health_status', 'last_heartbeat_at', 'last_event_at', 'last_connected_at',
  'last_disconnected_at', 'restart_count', 'last_error_code',
].join(',');

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

const SECRET_KEY_PATTERN = /(secret|cipher|session|token|password|api[_-]?hash|api[_-]?key|access[_-]?key|refresh[_-]?key|credential|authorization|private[_-]?key)/i;

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    output[key] = sanitizeValue(item);
  }
  return output;
}

function normalizeSource(row) {
  if (!row) return null;
  const core = normalizeProviderRecord(row);
  return {
    ...core,
    sourceType: row.source_type ?? null,
    sourceInstanceId: row.source_instance_id ?? null,
    displayName: row.display_name ?? null,
    externalIdentity: row.external_identity ?? null,
    config: row.config || {},
    health: {
      status: row.health_status || (core.enabled ? 'STARTING' : 'DISABLED'),
      lastHeartbeatAt: row.last_heartbeat_at ?? null,
      lastEventAt: row.last_event_at ?? null,
      lastConnectedAt: row.last_connected_at ?? null,
      lastDisconnectedAt: row.last_disconnected_at ?? null,
      restartCount: Number(row.restart_count || 0),
      lastErrorCode: row.last_error_code ?? null,
    },
  };
}

function publicHealth(health = {}) {
  return {
    status: health.status ?? null,
    lastHeartbeatAt: health.lastHeartbeatAt ?? null,
    lastEventAt: health.lastEventAt ?? null,
    lastConnectedAt: health.lastConnectedAt ?? null,
    lastDisconnectedAt: health.lastDisconnectedAt ?? null,
    restartCount: Number(health.restartCount || 0),
    lastErrorCode: health.lastErrorCode ?? null,
  };
}

function publicSource(source = {}) {
  return {
    id: source.id,
    providerType: source.providerType ?? null,
    sourceFamily: source.sourceFamily ?? null,
    sourceType: source.sourceType ?? null,
    sourceInstanceId: source.sourceInstanceId ?? null,
    displayName: source.displayName ?? null,
    enabled: Boolean(source.enabled),
    isDefault: Boolean(source.isDefault),
    priority: Number(source.priority || 0),
    externalIdentity: source.externalIdentity ?? null,
    config: sanitizeValue(source.config || {}),
    health: publicHealth(source.health || {}),
  };
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function can(authorization, permission) {
  return hasTradingPermission(authorization?.membership?.role, permission);
}

export function createAdminSourceStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  return {
    async listSources(workspaceId) {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from('source_connections')
        .select(SOURCE_SELECT)
        .eq('workspace_id', String(workspaceId))
        .order('priority', { ascending: true });
      if (error) throw new Error('SOURCE_LIST_FAILED');
      return (data || []).map(normalizeSource).sort((a, b) => a.priority - b.priority);
    },

    async getSource(workspaceId, sourceId) {
      if (!workspaceId || !sourceId) return null;
      const { data, error } = await supabase
        .from('source_connections')
        .select(SOURCE_SELECT)
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(sourceId))
        .maybeSingle();
      if (error) throw new Error('SOURCE_READ_FAILED');
      return normalizeSource(data);
    },

    async setDefaultSource(workspaceId, sourceFamily, sourceId) {
      if (!workspaceId || !sourceFamily || !sourceId || !supabase?.rpc) {
        throw new Error('SOURCE_DEFAULT_UPDATE_REJECTED');
      }
      const { data, error } = await supabase.rpc('trading_set_default_source', {
        p_workspace_id: String(workspaceId),
        p_source_family: String(sourceFamily),
        p_source_id: String(sourceId),
      });
      if (error || !data) throw new Error('SOURCE_DEFAULT_UPDATE_REJECTED');
      return data.provider_type ? normalizeSource(data) : data;
    },

    async setSourceEnabled(workspaceId, sourceId, enabled) {
      if (!workspaceId || !sourceId) throw new Error('SOURCE_STATE_UPDATE_FAILED');
      const active = Boolean(enabled);
      const update = active ? { is_active: true } : { is_active: false, is_default: false };
      const { data, error } = await supabase
        .from('source_connections')
        .update(update)
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(sourceId))
        .select(SOURCE_SELECT)
        .maybeSingle();
      if (error) throw new Error('SOURCE_STATE_UPDATE_FAILED');
      return normalizeSource(data);
    },
  };
}

export async function handleAuthorizedV1AdminSourcesRequest(request, authorization, {
  sourceStore,
} = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!sourceStore) return json({ ok: false, reason: 'SOURCE_STORE_UNAVAILABLE' }, 503);

  const url = new URL(request.url);
  const prefix = '/api/v1/admin/sources';
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    return json({ ok: false, reason: 'ADMIN_SOURCE_ROUTE_NOT_FOUND' }, 404);
  }

  if (url.pathname === prefix) {
    if (request.method !== 'GET') {
      return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
    }
    if (!can(authorization, 'sources.read')) {
      return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    }
    try {
      const sources = await sourceStore.listSources(workspaceId);
      return json({ ok: true, workspaceId, sources: (sources || []).map(publicSource) });
    } catch {
      return json({ ok: false, reason: 'SOURCE_LIST_FAILED' }, 503);
    }
  }

  const rest = url.pathname.slice(prefix.length + 1).split('/').filter(Boolean);
  const sourceId = rest[0] ? decodeURIComponent(rest[0]) : '';
  const action = rest[1] ?? null;
  if (!sourceId || rest.length > 2) return json({ ok: false, reason: 'ADMIN_SOURCE_ROUTE_NOT_FOUND' }, 404);

  if (!action) {
    if (request.method !== 'GET') {
      return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
    }
    if (!can(authorization, 'sources.read')) {
      return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    }
    try {
      const source = await sourceStore.getSource(workspaceId, sourceId);
      if (!source) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, source: publicSource(source) });
    } catch {
      return json({ ok: false, reason: 'SOURCE_READ_FAILED' }, 503);
    }
  }

  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  }
  if (!can(authorization, 'sources.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }

  if (action === 'default') {
    const body = await readJson(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    const sourceFamily = String(body.sourceFamily ?? body.source_family ?? '').trim();
    if (!sourceFamily) return json({ ok: false, reason: 'SOURCE_FAMILY_REQUIRED' }, 400);
    try {
      const source = await sourceStore.setDefaultSource(workspaceId, sourceFamily, sourceId);
      return json({ ok: true, workspaceId, source: publicSource(source) });
    } catch {
      return json({ ok: false, reason: 'SOURCE_DEFAULT_UPDATE_REJECTED' }, 409);
    }
  }

  if (action === 'enable' || action === 'disable') {
    try {
      const source = await sourceStore.setSourceEnabled(workspaceId, sourceId, action === 'enable');
      if (!source) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, source: publicSource(source) });
    } catch {
      return json({ ok: false, reason: 'SOURCE_STATE_UPDATE_FAILED' }, 503);
    }
  }

  return json({ ok: false, reason: 'ADMIN_SOURCE_ROUTE_NOT_FOUND' }, 404);
}
