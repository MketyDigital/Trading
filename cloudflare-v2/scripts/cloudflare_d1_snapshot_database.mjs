const API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_BATCH_SIZE = 100;

function validateConfiguration({ apiToken, accountId, databaseId }) {
  if (typeof apiToken !== 'string' || !apiToken.trim()) throw new Error('Cloudflare D1 API token is required');
  if (!/^[a-f0-9]{32}$/i.test(String(accountId || ''))) throw new Error('Cloudflare account id is invalid');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(databaseId || ''))) {
    throw new Error('Cloudflare D1 database id is invalid');
  }
}

function isImportUpsert(sql) {
  return typeof sql === 'string'
    && /^INSERT INTO (?:trading_storage\.)?"[a-z][a-z0-9_]{0,62}" \(.+\) VALUES \(.+\) ON CONFLICT \(.+\) DO (?:UPDATE SET .+|NOTHING)$/i.test(sql)
    && !sql.includes(';');
}

function normalizeQueryResult(payload) {
  if (payload?.success !== true || !Array.isArray(payload?.result) || !payload.result.length) {
    throw new Error('Cloudflare D1 query failed');
  }
  const first = payload.result[0];
  if (first?.success === false || !Array.isArray(first?.results)) {
    throw new Error('Cloudflare D1 query failed');
  }
  return first;
}

/** A narrow Cloudflare D1 adapter for the reviewed, upsert-only snapshot importer. */
export function createCloudflareD1SnapshotDatabase({
  apiToken,
  accountId,
  databaseId,
  expectedDatabaseName = 'trading-staging',
  fetchFn = fetch,
} = {}) {
  validateConfiguration({ apiToken, accountId, databaseId });
  if (typeof fetchFn !== 'function') throw new Error('Cloudflare D1 fetch function is unavailable');
  const endpoint = `${API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`;
  const identityEndpoint = `${API_BASE}/accounts/${accountId}/d1/database/${databaseId}`;
  let identityVerified = false;

  async function verifyIdentity() {
    if (identityVerified) return;
    let response;
    try {
      response = await fetchFn(identityEndpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
      });
    } catch {
      throw new Error('Cloudflare D1 target identity check failed');
    }
    if (!response?.ok) throw new Error('Cloudflare D1 target identity check failed');
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Cloudflare D1 target identity check failed');
    }
    if (payload?.success !== true || payload?.result?.uuid !== databaseId
      || payload?.result?.name !== expectedDatabaseName) {
      throw new Error('Cloudflare D1 target identity does not match the approved existing database');
    }
    identityVerified = true;
  }

  async function request(body) {
    let response;
    try {
      response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Cloudflare D1 request failed');
    }
    if (!response?.ok) throw new Error('Cloudflare D1 query failed');
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Cloudflare D1 query returned an invalid response');
    }
    if (payload?.success !== true || !Array.isArray(payload?.result)) {
      throw new Error('Cloudflare D1 query failed');
    }
    return payload;
  }

  const database = Object.freeze({
    identity: Object.freeze({ databaseId, databaseName: expectedDatabaseName }),
    async query(sql, params = []) {
      if (typeof sql !== 'string' || !sql.trim() || !Array.isArray(params)) {
        throw new Error('Cloudflare D1 query is invalid');
      }
      await verifyIdentity();
      const payload = await request({ sql, params });
      return normalizeQueryResult(payload);
    },

    prepare(sql) {
      if (typeof sql !== 'string' || !sql.trim()) throw new Error('Cloudflare D1 query is invalid');
      return Object.freeze({
        bind(...values) {
          return Object.freeze({ sql, values });
        },
        async all() {
          const result = await database.query(sql);
          return { results: result.results };
        },
      });
    },

    async batch(statements) {
      if (!Array.isArray(statements) || statements.length > MAX_BATCH_SIZE) {
        throw new Error(`Cloudflare D1 snapshot batch must contain at most ${MAX_BATCH_SIZE} statements`);
      }
      for (const statement of statements) {
        if (!isImportUpsert(statement?.sql) || !Array.isArray(statement?.values)) {
          throw new Error('Cloudflare D1 snapshot import accepts only INSERT upserts');
        }
      }
      if (!statements.length) return [];
      await verifyIdentity();
      const payload = await request({
        batch: statements.map(({ sql, values }) => ({ sql, params: values })),
      });
      if (payload.result.some((result) => result?.success !== true)) {
        throw new Error('Cloudflare D1 snapshot batch failed');
      }
      return payload.result;
    },
  });
  return database;
}
