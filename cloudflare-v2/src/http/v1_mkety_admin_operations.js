import {
  OPERATION_JOURNAL_STAGES,
  OPERATION_JOURNAL_STATUSES,
  sanitizeOperationDetails,
  sanitizeOperationString,
} from '../operations/operation_journal.js';

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function text(value, max = 1000) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function bearerOrHeaderSecret(request) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return request.headers.get('X-Mkety-Admin-Secret') || '';
}

function authorizeMketyAdmin(request, env = {}) {
  const expected = String(env.MKETY_TRADING_ADMIN_SECRET || env.TRADING_ADMIN_SECRET || '').trim();
  if (!expected) return { ok: false, status: 503, reason: 'MKETY_ADMIN_SECRET_NOT_CONFIGURED' };
  const provided = String(bearerOrHeaderSecret(request)).trim();
  if (!provided || provided !== expected) return { ok: false, status: 401, reason: 'MKETY_ADMIN_UNAUTHORIZED' };
  return { ok: true };
}

async function defaultSupabaseFactory(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVICE_NOT_CONFIGURED');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

function boundedLimit(value) {
  const numeric = Math.trunc(Number(value) || 50);
  return Math.max(1, Math.min(200, numeric));
}

function normalizedEnum(value, allowed) {
  const normalized = text(value, 64)?.toUpperCase() ?? null;
  if (!normalized) return null;
  return allowed.includes(normalized) ? normalized : undefined;
}

function optionalIso(value) {
  const normalized = text(value, 128);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function safeOperationRow(row = {}) {
  return {
    id: row.id ?? null,
    workspaceId: row.workspace_id ?? null,
    evidenceKey: row.evidence_key ?? null,
    correlationId: row.correlation_id ?? null,
    tradingEventId: row.trading_event_id ?? null,
    sourceConnectionId: row.source_connection_id ?? null,
    sourceFeedId: row.source_feed_id ?? null,
    routeId: row.route_id ?? null,
    destinationId: row.destination_id ?? null,
    tradeAccountId: row.trade_account_id ?? null,
    aiProviderId: row.ai_provider_id ?? null,
    positionGroupId: row.position_group_id ?? null,
    connectorId: row.connector_id ?? null,
    stage: row.stage ?? null,
    operation: row.operation ?? null,
    status: row.status ?? null,
    errorCode: row.error_code ?? null,
    failureClass: row.failure_class ?? null,
    retryable: row.retryable == null ? null : Boolean(row.retryable),
    summary: row.summary == null ? null : sanitizeOperationString(row.summary, 1000),
    details: sanitizeOperationDetails(row.details && typeof row.details === 'object' ? row.details : {}),
    observedAt: row.observed_at ?? null,
  };
}

const FILTER_COLUMNS = Object.freeze([
  ['workspaceId', 'workspace_id'],
  ['sourceConnectionId', 'source_connection_id'],
  ['sourceFeedId', 'source_feed_id'],
  ['routeId', 'route_id'],
  ['destinationId', 'destination_id'],
  ['tradeAccountId', 'trade_account_id'],
  ['aiProviderId', 'ai_provider_id'],
  ['positionGroupId', 'position_group_id'],
  ['connectorId', 'connector_id'],
  ['correlationId', 'correlation_id'],
]);

export function createMketyAdminOperationsStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  return {
    async list(filters = {}) {
      const limit = boundedLimit(filters.limit);
      let query = supabase
        .from('operation_journal')
        .select('id,workspace_id,evidence_key,correlation_id,trading_event_id,source_connection_id,source_feed_id,route_id,destination_id,trade_account_id,ai_provider_id,position_group_id,connector_id,stage,operation,status,error_code,failure_class,retryable,summary,details,observed_at');

      for (const [key, column] of FILTER_COLUMNS) {
        const value = text(filters[key]);
        if (value) query = query.eq(column, value);
      }
      if (filters.stage) query = query.eq('stage', filters.stage);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.from) query = query.gte('observed_at', filters.from);
      if (filters.to) query = query.lte('observed_at', filters.to);
      if (filters.before) query = query.lt('observed_at', filters.before);

      const { data, error } = await query
        .order('observed_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error('MKETY_ADMIN_OPERATIONS_QUERY_FAILED');
      return (Array.isArray(data) ? data : []).map(safeOperationRow);
    },
  };
}

function filtersFromUrl(url) {
  const stage = normalizedEnum(url.searchParams.get('stage'), OPERATION_JOURNAL_STAGES);
  const status = normalizedEnum(url.searchParams.get('status'), OPERATION_JOURNAL_STATUSES);
  const from = optionalIso(url.searchParams.get('from'));
  const to = optionalIso(url.searchParams.get('to'));
  const before = optionalIso(url.searchParams.get('before'));
  if (stage === undefined) return { ok: false, reason: 'OPERATION_STAGE_INVALID' };
  if (status === undefined) return { ok: false, reason: 'OPERATION_STATUS_INVALID' };
  if (from === undefined || to === undefined || before === undefined) return { ok: false, reason: 'OPERATION_TIME_INVALID' };

  const filters = {
    stage,
    status,
    from,
    to,
    before,
    limit: boundedLimit(url.searchParams.get('limit')),
  };
  for (const [key] of FILTER_COLUMNS) filters[key] = text(url.searchParams.get(key));
  return { ok: true, filters };
}

export async function handleMketyAdminOperationsRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  operationsStoreFactory = createMketyAdminOperationsStore,
} = {}) {
  const authorization = authorizeMketyAdmin(request, env);
  if (!authorization.ok) return json({ ok: false, reason: authorization.reason }, authorization.status);

  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/mkety-admin/operations') return json({ ok: false, reason: 'MKETY_ADMIN_ROUTE_NOT_FOUND' }, 404);
  if (request.method !== 'GET') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });

  const parsed = filtersFromUrl(url);
  if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);

  try {
    const supabase = await supabaseFactory(env);
    const operations = await operationsStoreFactory(supabase).list(parsed.filters);
    const nextBefore = operations.length > 0 ? operations[operations.length - 1].observedAt ?? null : null;
    return json({ ok: true, operations, nextBefore });
  } catch (error) {
    const reason = text(error?.message, 256) || 'MKETY_ADMIN_OPERATIONS_UNAVAILABLE';
    return json({ ok: false, reason }, 503);
  }
}
