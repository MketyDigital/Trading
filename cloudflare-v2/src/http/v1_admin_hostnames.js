import { createCloudflareCustomHostnameClient } from '../security/cloudflare_custom_hostnames.js';
import { canonicalTradingHostsFromEnv } from '../security/trading_hostname_resolver.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { requiresTradingEntitlement } from '../security/trading_entitlements.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function normalizeHostname(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw.length > 253 || raw.endsWith('.') || raw.includes('://') || raw.includes('/') || raw.includes(':') || raw.includes('*')) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return null;
  const labels = raw.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return null;
  }
  return raw;
}

function publicHostname(row = {}, provider = null, cnameTarget = null) {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    verifiedAt: row.verified_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    ...(cnameTarget ? { cname: { name: row.hostname, target: cnameTarget } } : {}),
    ...(provider ? {
      provider: {
        hostnameStatus: provider.hostnameStatus ?? null,
        sslStatus: provider.sslStatus ?? null,
        verificationErrors: provider.verificationErrors || [],
      },
      validation: provider.validation || { ownership: null, ownershipHttp: null, sslRecords: [] },
    } : {}),
  };
}

function configuredCnameTarget(env = {}) {
  return normalizeHostname(env.TRADING_CUSTOM_HOSTNAME_CNAME_TARGET);
}

function providerConfigured(env = {}, cnameTarget = configuredCnameTarget(env)) {
  return Boolean(cnameTarget && env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

function validateRequestedHostname(value, env = {}) {
  const hostname = normalizeHostname(value);
  if (!hostname) return null;
  const canonical = new Set(canonicalTradingHostsFromEnv(env).map((item) => String(item).toLowerCase()));
  const target = configuredCnameTarget(env);
  if (canonical.has(hostname) || (target && hostname === target)) return null;
  return hostname;
}

async function readJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return null;
  }
}

export function createAdminHostnameStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  return {
    async list(workspaceId) {
      const { data, error } = await supabase
        .from('trading_workspace_hostnames')
        .select('*')
        .eq('workspace_id', String(workspaceId))
        .order('created_at', { ascending: true });
      if (error) throw new Error('CUSTOM_HOSTNAME_LIST_FAILED');
      return data || [];
    },

    async get(workspaceId, id) {
      const { data, error } = await supabase
        .from('trading_workspace_hostnames')
        .select('*')
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(id))
        .maybeSingle();
      if (error) throw new Error('CUSTOM_HOSTNAME_READ_FAILED');
      return data || null;
    },

    async create(workspaceId, hostname) {
      const { data, error } = await supabase
        .from('trading_workspace_hostnames')
        .insert({
          workspace_id: String(workspaceId),
          hostname: String(hostname),
          status: 'pending',
          verified_at: null,
        })
        .select('*')
        .maybeSingle();
      if (error || !data) throw new Error('CUSTOM_HOSTNAME_CREATE_FAILED');
      return data;
    },

    async syncVerification(workspaceId, id, active) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('trading_workspace_hostnames')
        .update({
          status: active ? 'active' : 'pending',
          verified_at: active ? now : null,
          updated_at: now,
        })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(id))
        .select('*')
        .maybeSingle();
      if (error) throw new Error('CUSTOM_HOSTNAME_UPDATE_FAILED');
      return data || null;
    },
  };
}

export async function handleAuthorizedV1AdminHostnamesRequest(request, authorization, {
  hostnameStore,
  env = {},
  providerClientFactory = createCloudflareCustomHostnameClient,
} = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (requiresTradingEntitlement(authorization, 'customHostname')) {
    return json({ ok: false, reason: 'TRADING_ENTITLEMENT_REQUIRED' }, 403);
  }
  if (!hostnameStore) return json({ ok: false, reason: 'CUSTOM_HOSTNAME_STORE_UNAVAILABLE' }, 503);

  const url = new URL(request.url);
  const prefix = '/api/v1/admin/hostnames';
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    return json({ ok: false, reason: 'ADMIN_HOSTNAME_ROUTE_NOT_FOUND' }, 404);
  }

  const cnameTarget = configuredCnameTarget(env);

  if (url.pathname === prefix) {
    if (request.method === 'GET') {
      if (!hasTradingPermission(authorization.membership?.role, 'hostnames.read')) {
        return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      }
      try {
        const rows = await hostnameStore.list(workspaceId);
        return json({ ok: true, workspaceId, hostnames: rows.map((row) => publicHostname(row, null, cnameTarget)) });
      } catch {
        return json({ ok: false, reason: 'CUSTOM_HOSTNAME_LIST_FAILED' }, 503);
      }
    }

    if (request.method === 'POST') {
      if (!hasTradingPermission(authorization.membership?.role, 'hostnames.write')) {
        return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      }
      if (!providerConfigured(env, cnameTarget)) {
        return json({ ok: false, reason: 'CUSTOM_HOSTNAME_PROVIDER_NOT_CONFIGURED' }, 503);
      }
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const hostname = validateRequestedHostname(body.hostname, env);
      if (!hostname) return json({ ok: false, reason: 'CUSTOM_HOSTNAME_INVALID' }, 400);

      let providerClient;
      let provider;
      try {
        providerClient = providerClientFactory(env);
        provider = await providerClient.create(hostname);
      } catch {
        return json({ ok: false, reason: 'CUSTOM_HOSTNAME_PROVIDER_CREATE_FAILED' }, 503);
      }

      try {
        const row = await hostnameStore.create(workspaceId, hostname);
        return json({ ok: true, workspaceId, hostname: publicHostname(row, provider, cnameTarget) }, 201);
      } catch {
        if (provider?.providerId && providerClient?.delete) {
          try { await providerClient.delete(provider.providerId); } catch { /* best-effort orphan cleanup */ }
        }
        return json({ ok: false, reason: 'CUSTOM_HOSTNAME_CREATE_FAILED' }, 409);
      }
    }

    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const rest = url.pathname.slice(prefix.length + 1).split('/').filter(Boolean);
  if (rest.length !== 2 || rest[1] !== 'verify') return json({ ok: false, reason: 'ADMIN_HOSTNAME_ROUTE_NOT_FOUND' }, 404);
  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  if (!hasTradingPermission(authorization.membership?.role, 'hostnames.write')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }
  if (!providerConfigured(env, cnameTarget)) {
    return json({ ok: false, reason: 'CUSTOM_HOSTNAME_PROVIDER_NOT_CONFIGURED' }, 503);
  }

  let id;
  try { id = decodeURIComponent(rest[0]); } catch { return json({ ok: false, reason: 'CUSTOM_HOSTNAME_ID_INVALID' }, 400); }
  if (!String(id).trim()) return json({ ok: false, reason: 'CUSTOM_HOSTNAME_ID_INVALID' }, 400);

  let row;
  try {
    row = await hostnameStore.get(workspaceId, id);
  } catch {
    return json({ ok: false, reason: 'CUSTOM_HOSTNAME_READ_FAILED' }, 503);
  }
  if (!row) return json({ ok: false, reason: 'CUSTOM_HOSTNAME_NOT_FOUND' }, 404);

  let provider;
  try {
    const providerClient = providerClientFactory(env);
    provider = await providerClient.getByHostname(row.hostname);
  } catch {
    return json({ ok: false, reason: 'CUSTOM_HOSTNAME_PROVIDER_READ_FAILED' }, 503);
  }
  if (!provider) return json({ ok: false, reason: 'CUSTOM_HOSTNAME_PROVIDER_NOT_FOUND' }, 409);

  const active = provider.hostnameStatus === 'active' && provider.sslStatus === 'active';
  let updated;
  try {
    updated = await hostnameStore.syncVerification(workspaceId, id, active);
  } catch {
    return json({ ok: false, reason: 'CUSTOM_HOSTNAME_UPDATE_FAILED' }, 503);
  }
  if (!updated) return json({ ok: false, reason: 'CUSTOM_HOSTNAME_NOT_FOUND' }, 404);

  return json({
    ok: true,
    workspaceId,
    verified: active,
    hostname: publicHostname(updated, provider, cnameTarget),
  });
}
