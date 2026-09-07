const DEFAULT_CANONICAL_HOSTS = ['trade.mkety.com'];

export function normalizeTradingHostname(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
}

function canonicalHostSet(canonicalHosts = DEFAULT_CANONICAL_HOSTS) {
  return new Set(
    (Array.isArray(canonicalHosts) ? canonicalHosts : String(canonicalHosts ?? '').split(','))
      .map(normalizeTradingHostname)
      .filter(Boolean),
  );
}

function normalizeMapping(data) {
  if (!data) return null;
  return {
    hostname: normalizeTradingHostname(data.hostname),
    workspaceId: String(data.workspace_id ?? data.workspaceId),
    status: String(data.status),
    verifiedAt: data.verified_at ?? data.verifiedAt ?? null,
  };
}

export function createTradingHostnameStore(supabase) {
  if (!supabase?.from) throw new Error('TRADING_HOSTNAME_STORE_UNAVAILABLE');

  return {
    async getActiveHostname(hostname) {
      const normalized = normalizeTradingHostname(hostname);
      if (!normalized) return null;

      const { data, error } = await supabase
        .from('trading_workspace_hostnames')
        .select('hostname,workspace_id,status,verified_at')
        .eq('hostname', normalized)
        .eq('status', 'active')
        .maybeSingle();

      if (error) throw new Error('TRADING_HOSTNAME_LOOKUP_FAILED');
      if (!data) return null;
      const mapping = normalizeMapping(data);
      return mapping.status === 'active' ? mapping : null;
    },
  };
}

export async function resolveTradingRequestHostname(request, {
  hostnameStore,
  canonicalHosts = DEFAULT_CANONICAL_HOSTS,
  customHostnamesEnabled = true,
} = {}) {
  let hostname;
  try {
    hostname = normalizeTradingHostname(new URL(request.url).hostname);
  } catch {
    return { ok: false, reason: 'INVALID_TRADING_HOSTNAME' };
  }

  if (!hostname) return { ok: false, reason: 'INVALID_TRADING_HOSTNAME' };

  if (canonicalHostSet(canonicalHosts).has(hostname)) {
    return { ok: true, kind: 'canonical', hostname, workspaceId: null };
  }

  if (!customHostnamesEnabled) {
    return { ok: false, reason: 'TRADING_CUSTOM_HOSTNAMES_DISABLED' };
  }

  if (!hostnameStore?.getActiveHostname) {
    return { ok: false, reason: 'TRADING_HOSTNAME_STORE_UNAVAILABLE' };
  }

  let mapping;
  try {
    mapping = await hostnameStore.getActiveHostname(hostname);
  } catch {
    return { ok: false, reason: 'TRADING_HOSTNAME_LOOKUP_FAILED' };
  }

  if (!mapping?.workspaceId || mapping.status !== 'active') {
    return { ok: false, reason: 'TRADING_HOSTNAME_NOT_ACTIVE' };
  }

  return {
    ok: true,
    kind: 'custom',
    hostname,
    workspaceId: String(mapping.workspaceId),
  };
}

export function canonicalTradingHostsFromEnv(env = {}) {
  const configured = String(env.TRADING_CANONICAL_HOSTS ?? '').trim();
  if (!configured) return DEFAULT_CANONICAL_HOSTS;
  return configured.split(',').map(normalizeTradingHostname).filter(Boolean);
}
