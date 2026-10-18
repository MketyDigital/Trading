/**
 * Narrow PostgREST client for the one-time, read-only migration/recovery tools.
 * The Worker runtime never imports this module or connects to Supabase.
 */
const PROJECT_HOST = 'vdblajgxrfndjesoyayy.supabase.co';

function filterValue(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  if (!/[(),.*:"\\]/.test(text)) return text;
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function encodedFilter(value) {
  return encodeURIComponent(String(value)).replaceAll('%2C', ',').replaceAll('%28', '(').replaceAll('%29', ')');
}

export function createPostgrestMigrationClient({ url, serviceRole, fetchFn = fetch } = {}) {
  const base = new URL(String(url || ''));
  if (base.protocol !== 'https:' || base.hostname.toLowerCase() !== PROJECT_HOST) {
    throw new Error('Migration source URL does not match the pinned Trading project');
  }
  if (!String(serviceRole || '').trim() || typeof fetchFn !== 'function') {
    throw new Error('Migration source read credentials are incomplete');
  }

  return {
    from(tableName) {
      const table = String(tableName || '');
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) throw new Error('Migration source table name is invalid');
      let method = 'GET';
      let body;
      let selected = false;
      let single = false;
      let upsert = false;
      const params = new URLSearchParams();
      const headers = { accept: 'application/json' };
      const chain = {
        select(columns = '*') { params.set('select', String(columns)); selected = true; return chain; },
        insert(value) { method = 'POST'; body = value; return chain; },
        upsert(value, options = {}) { method = 'POST'; body = value; upsert = true; if (options.onConflict) params.set('on_conflict', String(options.onConflict)); return chain; },
        update(value) { method = 'PATCH'; body = value; return chain; },
        delete() { method = 'DELETE'; return chain; },
        eq(column, value) { params.set(String(column), `eq.${filterValue(value)}`); return chain; },
        neq(column, value) { params.set(String(column), `neq.${filterValue(value)}`); return chain; },
        gte(column, value) { params.set(String(column), `gte.${filterValue(value)}`); return chain; },
        lte(column, value) { params.set(String(column), `lte.${filterValue(value)}`); return chain; },
        gt(column, value) { params.set(String(column), `gt.${filterValue(value)}`); return chain; },
        lt(column, value) { params.set(String(column), `lt.${filterValue(value)}`); return chain; },
        in(column, values = []) { params.set(String(column), `in.(${values.map(filterValue).join(',')})`); return chain; },
        contains(column, value) { params.set(String(column), `cs.${JSON.stringify(value)}`); return chain; },
        not(column, operator, value) { params.set(String(column), `not.${operator}.${filterValue(value)}`); return chain; },
        or(expression) { params.set('or', `(${String(expression)})`); return chain; },
        order(column, options = {}) {
          const previous = params.get('order');
          const term = `${String(column)}.${options.ascending === false ? 'desc' : 'asc'}`;
          params.set('order', previous ? `${previous},${term}` : term);
          return chain;
        },
        limit(count) { params.set('limit', String(count)); return chain; },
        range(from, to) { headers.range = `${from}-${to}`; headers['range-unit'] = 'items'; return chain; },
        single() { single = true; return chain; },
        maybeSingle() { single = true; return chain; },
        then(resolve, reject) { return perform().then(resolve, reject); },
      };

      async function perform() {
        const requestUrl = new URL(`/rest/v1/${encodeURIComponent(table)}`, base);
        requestUrl.search = params.toString();
        const requestHeaders = {
          apikey: String(serviceRole),
          authorization: `Bearer ${serviceRole}`,
          ...headers,
        };
        if (body !== undefined) {
          requestHeaders['content-type'] = 'application/json';
          requestHeaders.prefer = [selected ? 'return=representation' : 'return=minimal', upsert ? 'resolution=merge-duplicates' : ''].filter(Boolean).join(',');
        }
        if (single) requestHeaders.accept = 'application/vnd.pgrst.object+json';
        const response = await fetchFn(requestUrl, {
          method,
          headers: requestHeaders,
          signal: AbortSignal.timeout(30_000),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (single && response.status === 406) {
          const error = await response.json().catch(() => ({}));
          if (/0 rows|no rows/i.test(String(error?.details || error?.message || ''))) return { data: null, error: null };
        }
        if (response.status === 204) return { data: null, error: null };
        const payload = await response.json().catch(() => null);
        if (!response.ok) return { data: null, error: { code: payload?.code || `HTTP_${response.status}`, message: payload?.message || 'PostgREST request failed' } };
        return { data: payload, error: null };
      }
      return chain;
    },
  };
}

