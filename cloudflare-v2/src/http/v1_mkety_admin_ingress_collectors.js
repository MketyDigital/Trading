function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function clean(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function bearerOrHeaderSecret(request) {
  const auth = request.headers.get('Authorization') || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return request.headers.get('X-Mkety-Admin-Secret') || '';
}

function authorize(request, env = {}) {
  const expected = clean(env.MKETY_TRADING_ADMIN_SECRET || env.TRADING_ADMIN_SECRET);
  if (!expected) return { ok: false, status: 503, reason: 'MKETY_ADMIN_SECRET_NOT_CONFIGURED' };
  return clean(bearerOrHeaderSecret(request)) === expected
    ? { ok: true }
    : { ok: false, status: 401, reason: 'MKETY_ADMIN_UNAUTHORIZED' };
}

async function defaultSupabaseFactory(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function nativeRandomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeCollector(row = {}) {
  return {
    id: row.id,
    name: row.collector_name ?? row.name ?? null,
    active: Boolean(row.is_active ?? row.active),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    lastSeenAt: row.last_seen_at ?? row.lastSeenAt ?? null,
  };
}

const SELECT = 'id,collector_name,is_active,metadata,last_seen_at,created_at,updated_at';

export function createIngressCollectorStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  return {
    async listCollectors() {
      const { data, error } = await supabase.from('trading_ingress_collectors').select(SELECT).order('created_at', { ascending: false });
      if (error) throw new Error('COLLECTOR_LIST_FAILED');
      return data || [];
    },
    async createCollector(record) {
      const { data, error } = await supabase.from('trading_ingress_collectors').insert(record).select(SELECT).maybeSingle();
      if (error || !data) throw new Error('COLLECTOR_CREATE_FAILED');
      return data;
    },
    async rotateCollector(id, tokenHash) {
      const { data, error } = await supabase.from('trading_ingress_collectors')
        .update({ token_hash: tokenHash, updated_at: new Date().toISOString() })
        .eq('id', id).select(SELECT).maybeSingle();
      if (error) throw new Error('COLLECTOR_ROTATE_FAILED');
      return data || null;
    },
    async setCollectorActive(id, enabled) {
      const { data, error } = await supabase.from('trading_ingress_collectors')
        .update({ is_active: Boolean(enabled), updated_at: new Date().toISOString() })
        .eq('id', id).select(SELECT).maybeSingle();
      if (error) throw new Error('COLLECTOR_UPDATE_FAILED');
      return data || null;
    },
  };
}

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch { return null; }
}

function actionFromPath(pathname) {
  const match = String(pathname).match(/^\/api\/v1\/mkety-admin\/ingress-collectors\/([^/]+)\/(rotate|revoke|activate)$/);
  return match ? { id: decodeURIComponent(match[1]), action: match[2] } : null;
}

export async function handleMketyAdminIngressCollectorsRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  store = null,
  randomToken = nativeRandomToken,
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  const auth = authorize(request, env);
  if (!auth.ok) return json({ ok: false, reason: auth.reason }, auth.status);

  let collectorStore = store;
  if (!collectorStore) {
    try { collectorStore = createIngressCollectorStore(await supabaseFactory(env)); }
    catch { return json({ ok: false, reason: 'COLLECTOR_STORE_UNAVAILABLE' }, 503); }
  }

  const url = new URL(request.url);
  const action = actionFromPath(url.pathname);
  if (action) {
    if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
    try {
      if (action.action === 'rotate') {
        const oneTimeToken = String(randomToken());
        const row = await collectorStore.rotateCollector(action.id, await sha256Hex(oneTimeToken));
        if (!row) return json({ ok: false, reason: 'COLLECTOR_NOT_FOUND' }, 404);
        return json({
          ok: true,
          collector: safeCollector(row),
          oneTimeToken,
          endpointUrl: `${url.origin}/api/v1/external/mtproto/collect/${encodeURIComponent(oneTimeToken)}`,
        });
      }
      const row = await collectorStore.setCollectorActive(action.id, action.action === 'activate');
      if (!row) return json({ ok: false, reason: 'COLLECTOR_NOT_FOUND' }, 404);
      return json({ ok: true, collector: safeCollector(row) });
    } catch {
      return json({ ok: false, reason: 'COLLECTOR_UPDATE_FAILED' }, 503);
    }
  }

  if (url.pathname !== '/api/v1/mkety-admin/ingress-collectors') {
    return json({ ok: false, reason: 'MKETY_ADMIN_ROUTE_NOT_FOUND' }, 404);
  }

  if (request.method === 'GET') {
    try {
      const rows = await collectorStore.listCollectors();
      return json({ ok: true, collectors: rows.map(safeCollector) });
    } catch { return json({ ok: false, reason: 'COLLECTOR_LIST_FAILED' }, 503); }
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    const name = clean(body.name ?? body.collectorName);
    if (!name) return json({ ok: false, reason: 'COLLECTOR_NAME_REQUIRED' }, 400);
    const oneTimeToken = String(randomToken());
    const id = String(randomUUID());
    const metadata = {
      ...(body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}),
      ...(clean(body.externalIdentity) ? { external_identity: clean(body.externalIdentity) } : {}),
    };
    try {
      const row = await collectorStore.createCollector({
        id,
        collector_name: name,
        token_hash: await sha256Hex(oneTimeToken),
        is_active: true,
        metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return json({
        ok: true,
        collector: safeCollector(row),
        oneTimeToken,
        endpointUrl: `${url.origin}/api/v1/external/mtproto/collect/${encodeURIComponent(oneTimeToken)}`,
      }, 201);
    } catch { return json({ ok: false, reason: 'COLLECTOR_CREATE_FAILED' }, 503); }
  }

  return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
}
