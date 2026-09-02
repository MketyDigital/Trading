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
