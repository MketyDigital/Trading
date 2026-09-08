function requiredText(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function providerError(reason) {
  const error = new Error(reason);
  error.code = reason;
  return error;
}

function safeValidation(result = {}) {
  const ownership = result.ownership_verification && typeof result.ownership_verification === 'object'
    ? { name: result.ownership_verification.name ?? null, type: result.ownership_verification.type ?? null, value: result.ownership_verification.value ?? null }
    : null;
  const ownershipHttp = result.ownership_verification_http && typeof result.ownership_verification_http === 'object'
    ? { httpUrl: result.ownership_verification_http.http_url ?? null, httpBody: result.ownership_verification_http.http_body ?? null }
    : null;
  const sslRecords = Array.isArray(result.ssl?.validation_records)
    ? result.ssl.validation_records.map((record) => ({
      cname: record?.cname ?? null,
      cnameTarget: record?.cname_target ?? null,
      txtName: record?.txt_name ?? null,
      txtValue: record?.txt_value ?? null,
      httpUrl: record?.http_url ?? null,
      httpBody: record?.http_body ?? null,
      status: record?.status ?? null,
      wildcard: Boolean(record?.wildcard),
    }))
    : [];
  return { ownership, ownershipHttp, sslRecords };
}

function safeHostname(result = {}, extra = {}) {
  return {
    providerId: result.id ? String(result.id) : null,
    hostname: result.hostname ? String(result.hostname).toLowerCase() : null,
    hostnameStatus: result.status ?? null,
    sslStatus: result.ssl?.status ?? null,
    verificationErrors: Array.isArray(result.verification_errors) ? result.verification_errors.map((value) => String(value).slice(0, 300)).slice(0, 10) : [],
    validation: safeValidation(result),
    workerRouteConfigured: Boolean(extra.workerRouteConfigured),
  };
}

export function createCloudflareCustomHostnameClient(env = {}, { fetchFn = fetch } = {}) {
  const apiToken = requiredText(env.CLOUDFLARE_API_TOKEN, 'CLOUDFLARE_API_TOKEN');
  const zoneId = requiredText(env.CLOUDFLARE_ZONE_ID, 'CLOUDFLARE_ZONE_ID');
  const workerScript = requiredText(env.TRADING_WORKER_SCRIPT_NAME || 'mkety-copier-engine', 'TRADING_WORKER_SCRIPT_NAME');
  if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is required');

  const apiBase = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}`;
  const hostnamesUrl = `${apiBase}/custom_hostnames`;
  const routesUrl = `${apiBase}/workers/routes`;

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetchFn(url, {
        ...options,
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch {
      throw providerError('CUSTOM_HOSTNAME_PROVIDER_UNAVAILABLE');
    }
    let body;
    try { body = await response.json(); }
    catch { throw providerError('CUSTOM_HOSTNAME_PROVIDER_INVALID_RESPONSE'); }
    if (!response.ok || body?.success === false) throw providerError('CUSTOM_HOSTNAME_PROVIDER_REJECTED');
    return body?.result;
  }

  async function createWorkerRoute(hostname) {
    const pattern = `${requiredText(hostname, 'hostname').toLowerCase()}/*`;
    const existing = await request(routesUrl, { method: 'GET' });
    const rows = Array.isArray(existing) ? existing : [];
    const found = rows.find((row) => String(row?.pattern ?? '').toLowerCase() === pattern);
    if (found?.id) return String(found.id);
    const result = await request(routesUrl, { method: 'POST', body: JSON.stringify({ pattern, script: workerScript }) });
    if (!result?.id) throw providerError('CUSTOM_HOSTNAME_WORKER_ROUTE_FAILED');
    return String(result.id);
  }

  async function deleteWorkerRouteFor(hostname) {
    try {
      const pattern = `${requiredText(hostname, 'hostname').toLowerCase()}/*`;
      const existing = await request(routesUrl, { method: 'GET' });
      const rows = Array.isArray(existing) ? existing : [];
      const found = rows.find((row) => String(row?.pattern ?? '').toLowerCase() === pattern);
      if (found?.id) await request(`${routesUrl}/${encodeURIComponent(found.id)}`, { method: 'DELETE' });
    } catch {
      // best-effort cleanup; provider hostname cleanup remains authoritative
    }
  }

  return {
    async create(hostname) {
      const normalized = requiredText(hostname, 'hostname').toLowerCase();
      const result = await request(hostnamesUrl, {
        method: 'POST',
        body: JSON.stringify({ hostname: normalized, ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } } }),
      });
      if (!result?.id || !result?.hostname) throw providerError('CUSTOM_HOSTNAME_PROVIDER_INVALID_RESPONSE');
      try {
        await createWorkerRoute(normalized);
      } catch (error) {
        try { await request(`${hostnamesUrl}/${encodeURIComponent(result.id)}`, { method: 'DELETE' }); } catch { /* best effort */ }
        throw error;
      }
      return safeHostname(result, { workerRouteConfigured: true });
    },

    async getByHostname(hostname) {
      const normalized = requiredText(hostname, 'hostname').toLowerCase();
      const result = await request(`${hostnamesUrl}?hostname=${encodeURIComponent(normalized)}`, { method: 'GET' });
      const rows = Array.isArray(result) ? result : [];
      const match = rows.find((row) => String(row?.hostname ?? '').toLowerCase() === normalized);
      if (!match) return null;
      let workerRouteConfigured = false;
      try {
        const routes = await request(routesUrl, { method: 'GET' });
        workerRouteConfigured = Array.isArray(routes) && routes.some((row) => String(row?.pattern ?? '').toLowerCase() === `${normalized}/*` && String(row?.script ?? '') === workerScript);
      } catch { workerRouteConfigured = false; }
      return safeHostname(match, { workerRouteConfigured });
    },

    async delete(providerId, hostname = null) {
      if (hostname) await deleteWorkerRouteFor(hostname);
      await request(`${hostnamesUrl}/${encodeURIComponent(requiredText(providerId, 'providerId'))}`, { method: 'DELETE' });
      return true;
    },
  };
}
