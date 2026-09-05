import { getProviderDefinition, normalizeProviderRecord } from '../sources/provider_registry.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import {
  encryptConnectionCredentials,
  validateConnectionCredentials,
} from '../security/connection_credentials.js';
import { encryptSecret } from '../security/secret_box.js';

const SOURCE_SELECT = [
  'id', 'workspace_id', 'source_type', 'source_instance_id', 'display_name', 'is_active',
  'source_family', 'provider_type', 'is_default', 'priority', 'external_identity', 'public_source_handle', 'config',
  'provider_secret_ciphertext', 'health_status', 'last_heartbeat_at', 'last_event_at',
  'last_connected_at', 'last_disconnected_at', 'restart_count', 'last_error_code',
].join(',');

const SOURCE_CREDENTIAL_KIND_BY_PROVIDER = Object.freeze({
  cloudflare_container_mtproto: 'mtproto',
  cloudflare_do_mtproto: 'mtproto',
  external_mtproto: 'mtproto',
  mt5_source_bridge: 'mt5',
  ctrader_source: 'ctrader',
});

const NON_CREDENTIAL_ONBOARDING_PROVIDERS = new Set([
  'tradingview_webhook',
  'custom_signed_api',
]);

function sourceCredentialKind(providerType) {
  return SOURCE_CREDENTIAL_KIND_BY_PROVIDER[String(providerType ?? '')] ?? null;
}

function isNonCredentialOnboardingProvider(providerType) {
  return NON_CREDENTIAL_ONBOARDING_PROVIDERS.has(String(providerType ?? ''));
}

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
  const enabled = Boolean(row.is_active ?? row.enabled ?? core.enabled);
  const credentialConfigured = Boolean(
    row.provider_secret_ciphertext ?? row.providerSecretCiphertext ?? row.credentialConfigured ?? row.credentialsConfigured,
  );
  return {
    ...core,
    enabled,
    sourceType: row.source_type ?? row.sourceType ?? null,
    sourceInstanceId: row.source_instance_id ?? row.sourceInstanceId ?? null,
    displayName: row.display_name ?? row.displayName ?? null,
    externalIdentity: row.external_identity ?? row.externalIdentity ?? null,
    publicSourceHandle: row.public_source_handle ?? row.publicSourceHandle ?? null,
    config: row.config || {},
    credentialConfigured,
    credentialsConfigured: credentialConfigured,
    health: row.health || {
      status: row.health_status || (enabled ? 'STARTING' : 'DISABLED'),
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
  const credentialConfigured = Boolean(source.credentialConfigured ?? source.credentialsConfigured ?? source.providerSecretCiphertext);
  const providerType = source.providerType ?? null;
  const publicSourceHandle = source.publicSourceHandle ?? null;
  return {
    id: source.id,
    providerType,
    sourceFamily: source.sourceFamily ?? null,
    sourceType: source.sourceType ?? null,
    sourceInstanceId: source.sourceInstanceId ?? null,
    displayName: source.displayName ?? null,
    enabled: Boolean(source.enabled),
    isDefault: Boolean(source.isDefault),
    priority: Number(source.priority || 0),
    externalIdentity: source.externalIdentity ?? null,
    publicSourceHandle,
    ...(providerType === 'tradingview_webhook' && publicSourceHandle
      ? { webhookPath: `/api/v1/webhooks/tradingview/${encodeURIComponent(publicSourceHandle)}` }
      : {}),
    config: sanitizeValue(source.config || {}),
    credentialConfigured,
    credentialsConfigured: credentialConfigured,
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

function requiredText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function safePriority(value) {
  if (value === undefined || value === null || value === '') return 0;
  const priority = Number(value);
  return Number.isFinite(priority) ? priority : null;
}

function sourceCreationInput(body) {
  const providerType = requiredText(body.providerType ?? body.provider_type);
  const sourceFamily = requiredText(body.sourceFamily ?? body.source_family);
  const sourceType = requiredText(body.sourceType ?? body.source_type);
  const sourceInstanceId = requiredText(body.sourceInstanceId ?? body.source_instance_id);
  const priority = safePriority(body.priority);

  if (!providerType || !sourceFamily || !sourceType || !sourceInstanceId || priority === null) {
    return { ok: false, reason: 'SOURCE_CONFIGURATION_INVALID' };
  }

  let definition;
  try {
    definition = getProviderDefinition(providerType);
  } catch {
    return { ok: false, reason: 'SOURCE_PROVIDER_UNSUPPORTED' };
  }
  if (definition.sourceFamily !== sourceFamily) {
    return { ok: false, reason: 'SOURCE_PROVIDER_FAMILY_MISMATCH' };
  }

  const credentialKind = sourceCredentialKind(providerType);
  const nonCredentialOnboarding = isNonCredentialOnboardingProvider(providerType);
  if (!credentialKind && !nonCredentialOnboarding) {
    return { ok: false, reason: 'SOURCE_PROVIDER_UNSUPPORTED_FOR_ONBOARDING' };
  }

  if (credentialKind) {
    try {
      validateConnectionCredentials(credentialKind, body.credentials);
    } catch {
      return { ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' };
    }
  } else if (body.credentials !== undefined && body.credentials !== null) {
    return { ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' };
  }

  return {
    ok: true,
    credentialKind,
    nonCredentialOnboarding,
    credentials: body.credentials,
    input: {
      providerType,
      sourceFamily,
      sourceType,
      sourceInstanceId,
      displayName: requiredText(body.displayName ?? body.display_name),
      externalIdentity: requiredText(body.externalIdentity ?? body.external_identity),
      priority,
      config: sanitizeValue(body.config || {}),
      enabled: false,
      isDefault: false,
    },
  };
}

function randomIngressSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomPublicSourceHandle() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createAdminSourceStore(supabase, env = {}) {
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

    async createSource(workspaceId, input, providerSecretCiphertext = input?.providerSecretCiphertext) {
      if (!workspaceId || !input?.providerType || !input?.sourceFamily || !input?.sourceType || !input?.sourceInstanceId) {
        throw new Error('SOURCE_CREATE_FAILED');
      }
      if (!env?.TRADING_MASTER_KEY) throw new Error('SOURCE_ENCRYPTION_NOT_CONFIGURED');

      const credentialKind = sourceCredentialKind(input.providerType);
      if (credentialKind && !providerSecretCiphertext) throw new Error('SOURCE_CREATE_FAILED');
      if (!credentialKind && !isNonCredentialOnboardingProvider(input.providerType)) throw new Error('SOURCE_CREATE_FAILED');

      let ingressSecretCiphertext = input.ingressSecretCiphertext ?? null;
      if (!ingressSecretCiphertext) {
        try {
          ingressSecretCiphertext = await encryptSecret(randomIngressSecret(), env.TRADING_MASTER_KEY);
        } catch {
          throw new Error('SOURCE_ENCRYPTION_NOT_CONFIGURED');
        }
      }

      const insert = {
        workspace_id: String(workspaceId),
        source_type: String(input.sourceType),
        source_instance_id: String(input.sourceInstanceId),
        display_name: input.displayName ?? null,
        secret_ciphertext: String(ingressSecretCiphertext),
        settings: {},
        is_active: false,
        source_family: String(input.sourceFamily),
        provider_type: String(input.providerType),
        is_default: false,
        priority: Number(input.priority ?? 0),
        external_identity: input.externalIdentity ?? null,
        public_source_handle: input.publicSourceHandle ?? null,
        config: sanitizeValue(input.config || {}),
        provider_secret_ciphertext: providerSecretCiphertext ? String(providerSecretCiphertext) : null,
        health_status: 'DISABLED',
      };

      const { data, error } = await supabase
        .from('source_connections')
        .insert(insert)
        .select(SOURCE_SELECT)
        .maybeSingle();
      if (error || !data) throw new Error('SOURCE_CREATE_FAILED');
      return normalizeSource(data);
    },

    async replaceSourceCredentials(workspaceId, sourceId, providerSecretCiphertext) {
      if (!workspaceId || !sourceId || !providerSecretCiphertext) {
        throw new Error('SOURCE_CREDENTIAL_REPLACE_FAILED');
      }
      const { data, error } = await supabase
        .from('source_connections')
        .update({ provider_secret_ciphertext: String(providerSecretCiphertext) })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(sourceId))
        .select(SOURCE_SELECT)
        .maybeSingle();
      if (error) throw new Error('SOURCE_CREDENTIAL_REPLACE_FAILED');
      return normalizeSource(data);
    },

    async replaceIngressSecret(workspaceId, sourceId, secretCiphertext) {
      if (!workspaceId || !sourceId || !secretCiphertext) {
        throw new Error('SOURCE_INGRESS_SECRET_REPLACE_FAILED');
      }
      const { data, error } = await supabase
        .from('source_connections')
        .update({ secret_ciphertext: String(secretCiphertext) })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(sourceId))
        .select(SOURCE_SELECT)
        .maybeSingle();
      if (error) throw new Error('SOURCE_INGRESS_SECRET_REPLACE_FAILED');
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
  env = {},
  encryptCredentials = encryptConnectionCredentials,
  generatePublicSourceHandle = randomPublicSourceHandle,
  generateIngressSecret = randomIngressSecret,
  encryptIngressSecret = encryptSecret,
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
    if (request.method === 'GET') {
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

    if (request.method === 'POST') {
      if (!can(authorization, 'sources.write')) {
        return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      }
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = sourceCreationInput(body);
      if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      if (!env?.TRADING_MASTER_KEY) {
        return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503);
      }

      if (parsed.credentialKind) {
        let providerSecretCiphertext;
        try {
          providerSecretCiphertext = await encryptCredentials(parsed.credentialKind, parsed.credentials, env.TRADING_MASTER_KEY);
        } catch {
          return json({ ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' }, 400);
        }

        try {
          const input = { ...parsed.input, providerSecretCiphertext };
          const source = await sourceStore.createSource(workspaceId, input, providerSecretCiphertext);
          if (!source) return json({ ok: false, reason: 'SOURCE_CREATE_FAILED' }, 503);
          return json({ ok: true, workspaceId, source: publicSource({ ...source, credentialConfigured: true }) }, 201);
        } catch {
          return json({ ok: false, reason: 'SOURCE_CREATE_FAILED' }, 503);
        }
      }

      let ingressSecret;
      let ingressSecretCiphertext;
      try {
        ingressSecret = generateIngressSecret();
        ingressSecretCiphertext = await encryptIngressSecret(ingressSecret, env.TRADING_MASTER_KEY);
      } catch {
        return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503);
      }

      const publicSourceHandle = parsed.input.providerType === 'tradingview_webhook'
        ? requiredText(generatePublicSourceHandle())
        : null;
      if (parsed.input.providerType === 'tradingview_webhook' && !publicSourceHandle) {
        return json({ ok: false, reason: 'SOURCE_CREATE_FAILED' }, 503);
      }

      try {
        const input = {
          ...parsed.input,
          providerSecretCiphertext: null,
          ingressSecretCiphertext,
          publicSourceHandle,
        };
        const source = await sourceStore.createSource(workspaceId, input, null);
        if (!source) return json({ ok: false, reason: 'SOURCE_CREATE_FAILED' }, 503);
        const safeSource = publicSource({
          ...source,
          publicSourceHandle: source.publicSourceHandle ?? publicSourceHandle,
          credentialConfigured: false,
        });
        if (parsed.input.providerType === 'custom_signed_api') {
          return json({ ok: true, workspaceId, source: safeSource, oneTimeSigningSecret: ingressSecret }, 201);
        }
        return json({ ok: true, workspaceId, source: safeSource }, 201);
      } catch {
        return json({ ok: false, reason: 'SOURCE_CREATE_FAILED' }, 503);
      }
    }

    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
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

  if (action === 'credentials') {
    if (request.method !== 'PUT') {
      return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'PUT' });
    }
    if (!can(authorization, 'sources.write')) {
      return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
    }
    if (!env?.TRADING_MASTER_KEY) {
      return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503);
    }

    let existing;
    if (typeof sourceStore.getSource === 'function') {
      try {
        existing = await sourceStore.getSource(workspaceId, sourceId);
        if (!existing) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);
      } catch {
        return json({ ok: false, reason: 'SOURCE_READ_FAILED' }, 503);
      }
    }
    if (!existing) {
      return json({ ok: false, reason: 'SOURCE_PROVIDER_UNSUPPORTED_FOR_ONBOARDING' }, 400);
    }

    if (existing.providerType === 'custom_signed_api') {
      if (typeof sourceStore.replaceIngressSecret !== 'function') {
        return json({ ok: false, reason: 'SOURCE_INGRESS_SECRET_REPLACE_FAILED' }, 503);
      }
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);

      let signingSecret;
      let secretCiphertext;
      try {
        signingSecret = generateIngressSecret();
        secretCiphertext = await encryptIngressSecret(signingSecret, env.TRADING_MASTER_KEY);
      } catch {
        return json({ ok: false, reason: 'SOURCE_ENCRYPTION_NOT_CONFIGURED' }, 503);
      }

      try {
        const source = await sourceStore.replaceIngressSecret(workspaceId, sourceId, secretCiphertext);
        if (!source) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);
        return json({
          ok: true,
          workspaceId,
          source: publicSource({ ...source, credentialConfigured: false }),
          oneTimeSigningSecret: signingSecret,
        });
      } catch {
        return json({ ok: false, reason: 'SOURCE_INGRESS_SECRET_REPLACE_FAILED' }, 503);
      }
    }

    const credentialKind = sourceCredentialKind(existing.providerType);
    if (!credentialKind) {
      return json({ ok: false, reason: 'SOURCE_PROVIDER_UNSUPPORTED_FOR_ONBOARDING' }, 400);
    }

    const body = await readJson(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    try {
      validateConnectionCredentials(credentialKind, body.credentials);
    } catch {
      return json({ ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' }, 400);
    }

    let providerSecretCiphertext;
    try {
      providerSecretCiphertext = await encryptCredentials(credentialKind, body.credentials, env.TRADING_MASTER_KEY);
    } catch {
      return json({ ok: false, reason: 'SOURCE_CREDENTIALS_INVALID' }, 400);
    }

    try {
      const source = await sourceStore.replaceSourceCredentials(workspaceId, sourceId, providerSecretCiphertext);
      if (!source) return json({ ok: false, reason: 'SOURCE_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, source: publicSource({ ...source, credentialConfigured: true }) });
    } catch {
      return json({ ok: false, reason: 'SOURCE_CREDENTIAL_REPLACE_FAILED' }, 503);
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
