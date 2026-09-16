import { hasTradingPermission } from '../security/trading_permissions.js';
import { encryptSecret } from '../security/secret_box.js';

const CONNECTION_SELECT = [
  'id', 'workspace_id', 'provider_type', 'display_name', 'credential_ciphertext', 'is_active', 'created_at', 'updated_at',
].join(',');

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function can(authorization, permission) {
  return hasTradingPermission(authorization?.membership?.role, permission);
}

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function publicConnection(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? row.workspaceId,
    providerType: row.provider_type ?? row.providerType,
    displayName: row.display_name ?? row.displayName,
    enabled: Boolean(row.is_active ?? row.enabled),
    credentialConfigured: Boolean(row.credential_ciphertext ?? row.credentialConfigured),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function parseConnectionInput(body = {}) {
  const providerType = text(body.providerType ?? body.provider_type) || 'telegram_bot_api';
  const displayName = text(body.displayName ?? body.display_name);
  if (providerType !== 'telegram_bot_api') return { ok: false, reason: 'DESTINATION_CONNECTION_PROVIDER_UNSUPPORTED' };
  if (!displayName) return { ok: false, reason: 'DESTINATION_CONNECTION_NAME_REQUIRED' };
  return { ok: true, input: { providerType, displayName }, credentials: body.credentials };
}

function telegramCredential(credentials) {
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) return null;
  const botToken = text(credentials.botToken ?? credentials.bot_token);
  if (!botToken) return null;
  return { botToken };
}

async function encryptCredentialPayload(credentials, masterKey, encryptCredentials) {
  const normalized = telegramCredential(credentials);
  if (!normalized) throw new Error('DESTINATION_CONNECTION_CREDENTIALS_INVALID');
  if (!masterKey) throw new Error('DESTINATION_ENCRYPTION_NOT_CONFIGURED');
  return encryptCredentials(JSON.stringify({ version: 1, kind: 'destination', data: normalized }), masterKey);
}

export function createAdminDestinationConnectionStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  return {
    async listConnections(workspaceId) {
      const { data, error } = await supabase
        .from('trading_destination_connections')
        .select(CONNECTION_SELECT)
        .eq('workspace_id', String(workspaceId))
        .order('created_at', { ascending: true });
      if (error) throw new Error('DESTINATION_CONNECTION_LIST_FAILED');
      return data || [];
    },
    async createConnection(workspaceId, input, credentialCiphertext) {
      const row = {
        workspace_id: String(workspaceId),
        provider_type: input.providerType,
        display_name: input.displayName,
        credential_ciphertext: credentialCiphertext,
        is_active: true,
      };
      const { data, error } = await supabase
        .from('trading_destination_connections')
        .insert(row)
        .select(CONNECTION_SELECT)
        .maybeSingle();
      if (error || !data) throw new Error('DESTINATION_CONNECTION_CREATE_FAILED');
      return data;
    },
    async replaceCredentials(workspaceId, id, credentialCiphertext) {
      const { data, error } = await supabase
        .from('trading_destination_connections')
        .update({ credential_ciphertext: credentialCiphertext, updated_at: new Date().toISOString() })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(id))
        .select(CONNECTION_SELECT)
        .maybeSingle();
      if (error) throw new Error('DESTINATION_CONNECTION_CREDENTIALS_UPDATE_FAILED');
      return data || null;
    },
    async setEnabled(workspaceId, id, enabled) {
      const { data, error } = await supabase
        .from('trading_destination_connections')
        .update({ is_active: Boolean(enabled), updated_at: new Date().toISOString() })
        .eq('workspace_id', String(workspaceId))
        .eq('id', String(id))
        .select(CONNECTION_SELECT)
        .maybeSingle();
      if (error) throw new Error('DESTINATION_CONNECTION_UPDATE_FAILED');
      return data || null;
    },
  };
}

export async function handleAuthorizedV1AdminDestinationConnectionsRequest(request, authorization, {
  connectionStore,
  env = {},
  encryptCredentials = encryptSecret,
} = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!connectionStore) return json({ ok: false, reason: 'DESTINATION_CONNECTION_STORE_UNAVAILABLE' }, 503);
  const url = new URL(request.url);
  const base = '/api/v1/admin/destination-connections';

  if (url.pathname === base) {
    if (request.method === 'GET') {
      if (!can(authorization, 'sources.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      try {
        const rows = await connectionStore.listConnections(workspaceId);
        return json({ ok: true, workspaceId, destinationConnections: rows.map(publicConnection) });
      } catch {
        return json({ ok: false, reason: 'DESTINATION_CONNECTION_LIST_FAILED' }, 503);
      }
    }
    if (request.method === 'POST') {
      if (!can(authorization, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = parseConnectionInput(body);
      if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      let cipher;
      try {
        cipher = await encryptCredentialPayload(parsed.credentials, env.TRADING_MASTER_KEY, encryptCredentials);
      } catch {
        return json({ ok: false, reason: 'DESTINATION_CONNECTION_CREDENTIALS_INVALID' }, 400);
      }
      try {
        const row = await connectionStore.createConnection(workspaceId, parsed.input, cipher);
        return json({ ok: true, workspaceId, destinationConnection: publicConnection(row) }, 201);
      } catch {
        return json({ ok: false, reason: 'DESTINATION_CONNECTION_CREATE_FAILED' }, 503);
      }
    }
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  const match = url.pathname.match(/^\/api\/v1\/admin\/destination-connections\/([^/]+)\/(credentials|enable|disable)$/);
  if (!match) return json({ ok: false, reason: 'ADMIN_DESTINATION_CONNECTION_ROUTE_NOT_FOUND' }, 404);
  const id = decodeURIComponent(match[1]);
  const action = match[2];
  if (!can(authorization, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);

  if (action === 'credentials') {
    if (request.method !== 'PUT') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'PUT' });
    const body = await readJson(request);
    if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    let cipher;
    try {
      cipher = await encryptCredentialPayload(body.credentials, env.TRADING_MASTER_KEY, encryptCredentials);
    } catch {
      return json({ ok: false, reason: 'DESTINATION_CONNECTION_CREDENTIALS_INVALID' }, 400);
    }
    try {
      const row = await connectionStore.replaceCredentials(workspaceId, id, cipher);
      if (!row) return json({ ok: false, reason: 'DESTINATION_CONNECTION_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, destinationConnection: publicConnection(row) });
    } catch {
      return json({ ok: false, reason: 'DESTINATION_CONNECTION_CREDENTIALS_UPDATE_FAILED' }, 503);
    }
  }

  if (request.method !== 'POST') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'POST' });
  try {
    const row = await connectionStore.setEnabled(workspaceId, id, action === 'enable');
    if (!row) return json({ ok: false, reason: 'DESTINATION_CONNECTION_NOT_FOUND' }, 404);
    return json({ ok: true, workspaceId, destinationConnection: publicConnection(row) });
  } catch {
    return json({ ok: false, reason: 'DESTINATION_CONNECTION_UPDATE_FAILED' }, 503);
  }
}
