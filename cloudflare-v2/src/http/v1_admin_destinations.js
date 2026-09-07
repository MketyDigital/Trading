import { hasTradingPermission } from '../security/trading_permissions.js';
import { encryptSecret } from '../security/secret_box.js';

const DESTINATION_SELECT = [
  'id', 'workspace_id', 'destination_type', 'display_name', 'destination_ref', 'template_id',
  'credential_ciphertext', 'settings', 'is_active', 'health_status', 'last_delivery_at', 'last_error_code',
  'created_at', 'updated_at',
].join(',');

const TEMPLATE_SELECT = [
  'id', 'workspace_id', 'template_name', 'formatting_mode', 'parse_mode', 'brand_name', 'header',
  'footer', 'disclaimer', 'emoji_style', 'cleanup_rules', 'layout', 'is_default', 'created_at', 'updated_at',
].join(',');

const ROUTE_SELECT = [
  'id', 'workspace_id', 'source_connection_id', 'destination_id', 'route_name', 'priority', 'is_active',
  'filters', 'created_at', 'updated_at',
].join(',');

const DESTINATION_TYPES = new Set(['telegram', 'broker_account', 'internal_webhook', 'audit_only']);
const FORMAT_MODES = new Set(['none', 'clean', 'template', 'ai_then_fallback']);
const PARSE_MODES = new Set(['HTML', 'Markdown', 'MarkdownV2', 'plain']);

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
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

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function publicDestination(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? row.workspaceId,
    destinationType: row.destination_type ?? row.destinationType,
    displayName: row.display_name ?? row.displayName,
    destinationRef: row.destination_ref ?? row.destinationRef ?? null,
    templateId: row.template_id ?? row.templateId ?? null,
    settings: safeObject(row.settings),
    enabled: Boolean(row.is_active ?? row.enabled),
    healthStatus: row.health_status ?? row.healthStatus ?? null,
    lastDeliveryAt: row.last_delivery_at ?? row.lastDeliveryAt ?? null,
    lastErrorCode: row.last_error_code ?? row.lastErrorCode ?? null,
    credentialConfigured: Boolean(row.credential_ciphertext ?? row.credentialCiphertext ?? row.credentialConfigured),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function publicTemplate(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? row.workspaceId,
    templateName: row.template_name ?? row.templateName,
    formattingMode: row.formatting_mode ?? row.formattingMode,
    parseMode: row.parse_mode ?? row.parseMode,
    brandName: row.brand_name ?? row.brandName ?? null,
    header: row.header ?? null,
    footer: row.footer ?? null,
    disclaimer: row.disclaimer ?? null,
    emojiStyle: row.emoji_style ?? row.emojiStyle ?? null,
    cleanupRules: safeObject(row.cleanup_rules ?? row.cleanupRules),
    layout: safeObject(row.layout),
    isDefault: Boolean(row.is_default ?? row.isDefault),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function publicRoute(row = {}) {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? row.workspaceId,
    sourceConnectionId: row.source_connection_id ?? row.sourceConnectionId,
    destinationId: row.destination_id ?? row.destinationId,
    routeName: row.route_name ?? row.routeName ?? null,
    priority: Number(row.priority ?? 100),
    enabled: Boolean(row.is_active ?? row.enabled),
    filters: safeObject(row.filters),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

function parseDestinationInput(body = {}) {
  const destinationType = text(body.destinationType ?? body.destination_type);
  const displayName = text(body.displayName ?? body.display_name);
  if (!destinationType || !DESTINATION_TYPES.has(destinationType)) return { ok: false, reason: 'DESTINATION_TYPE_UNSUPPORTED' };
  if (!displayName) return { ok: false, reason: 'DESTINATION_NAME_REQUIRED' };
  if (destinationType !== 'audit_only' && !text(body.destinationRef ?? body.destination_ref)) return { ok: false, reason: 'DESTINATION_REF_REQUIRED' };
  return {
    ok: true,
    input: {
      destinationType,
      displayName,
      destinationRef: text(body.destinationRef ?? body.destination_ref),
      templateId: text(body.templateId ?? body.template_id),
      settings: safeObject(body.settings),
    },
    credentials: body.credentials,
  };
}

function parseTemplateInput(body = {}) {
  const templateName = text(body.templateName ?? body.template_name);
  const formattingMode = text(body.formattingMode ?? body.formatting_mode) || 'template';
  const parseMode = text(body.parseMode ?? body.parse_mode) || 'HTML';
  if (!templateName) return { ok: false, reason: 'TEMPLATE_NAME_REQUIRED' };
  if (!FORMAT_MODES.has(formattingMode)) return { ok: false, reason: 'FORMAT_MODE_UNSUPPORTED' };
  if (!PARSE_MODES.has(parseMode)) return { ok: false, reason: 'PARSE_MODE_UNSUPPORTED' };
  return {
    ok: true,
    input: {
      templateName,
      formattingMode,
      parseMode,
      brandName: text(body.brandName ?? body.brand_name),
      header: text(body.header),
      footer: text(body.footer),
      disclaimer: text(body.disclaimer),
      emojiStyle: text(body.emojiStyle ?? body.emoji_style) || 'standard',
      cleanupRules: safeObject(body.cleanupRules ?? body.cleanup_rules),
      layout: safeObject(body.layout),
      isDefault: Boolean(body.isDefault ?? body.is_default),
    },
  };
}

function parseRouteInput(body = {}) {
  const sourceConnectionId = text(body.sourceConnectionId ?? body.source_connection_id);
  const destinationId = text(body.destinationId ?? body.destination_id);
  const priority = Number(body.priority ?? 100);
  if (!sourceConnectionId) return { ok: false, reason: 'SOURCE_CONNECTION_REQUIRED' };
  if (!destinationId) return { ok: false, reason: 'DESTINATION_REQUIRED' };
  if (!Number.isFinite(priority)) return { ok: false, reason: 'ROUTE_PRIORITY_INVALID' };
  return {
    ok: true,
    input: {
      sourceConnectionId,
      destinationId,
      routeName: text(body.routeName ?? body.route_name),
      priority,
      filters: safeObject(body.filters),
    },
  };
}

async function encryptCredentialPayload(credentials, masterKey, encryptCredentials) {
  if (credentials == null) return null;
  if (!masterKey) throw new Error('DESTINATION_ENCRYPTION_NOT_CONFIGURED');
  return encryptCredentials(JSON.stringify({ version: 1, kind: 'destination', data: credentials }), masterKey);
}

export function createAdminDestinationStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  return {
    async listDestinations(workspaceId) {
      const { data, error } = await supabase.from('trading_destinations').select(DESTINATION_SELECT).eq('workspace_id', String(workspaceId)).order('created_at', { ascending: true });
      if (error) throw new Error('DESTINATION_LIST_FAILED');
      return data || [];
    },
    async createDestination(workspaceId, input, credentialCiphertext = null) {
      const row = {
        workspace_id: String(workspaceId),
        destination_type: input.destinationType,
        display_name: input.displayName,
        destination_ref: input.destinationRef,
        template_id: input.templateId || null,
        credential_ciphertext: credentialCiphertext,
        settings: input.settings || {},
        is_active: false,
        health_status: 'DISABLED',
      };
      const { data, error } = await supabase.from('trading_destinations').insert(row).select(DESTINATION_SELECT).maybeSingle();
      if (error || !data) throw new Error('DESTINATION_CREATE_FAILED');
      return data;
    },
    async listTemplates(workspaceId) {
      const { data, error } = await supabase.from('trading_destination_templates').select(TEMPLATE_SELECT).eq('workspace_id', String(workspaceId)).order('created_at', { ascending: true });
      if (error) throw new Error('TEMPLATE_LIST_FAILED');
      return data || [];
    },
    async createTemplate(workspaceId, input) {
      const row = {
        workspace_id: String(workspaceId),
        template_name: input.templateName,
        formatting_mode: input.formattingMode,
        parse_mode: input.parseMode,
        brand_name: input.brandName,
        header: input.header,
        footer: input.footer,
        disclaimer: input.disclaimer,
        emoji_style: input.emojiStyle,
        cleanup_rules: input.cleanupRules || {},
        layout: input.layout || {},
        is_default: Boolean(input.isDefault),
      };
      const { data, error } = await supabase.from('trading_destination_templates').insert(row).select(TEMPLATE_SELECT).maybeSingle();
      if (error || !data) throw new Error('TEMPLATE_CREATE_FAILED');
      return data;
    },
    async listRoutes(workspaceId) {
      const { data, error } = await supabase.from('source_destination_routes').select(ROUTE_SELECT).eq('workspace_id', String(workspaceId)).order('priority', { ascending: true });
      if (error) throw new Error('ROUTE_LIST_FAILED');
      return data || [];
    },
    async createRoute(workspaceId, input) {
      const row = {
        workspace_id: String(workspaceId),
        source_connection_id: input.sourceConnectionId,
        destination_id: input.destinationId,
        route_name: input.routeName,
        priority: input.priority ?? 100,
        is_active: true,
        filters: input.filters || {},
      };
      const { data, error } = await supabase.from('source_destination_routes').insert(row).select(ROUTE_SELECT).maybeSingle();
      if (error || !data) throw new Error('ROUTE_CREATE_FAILED');
      return data;
    },
  };
}

export async function handleAuthorizedV1AdminDestinationsRequest(request, authorization, {
  destinationStore,
  env = {},
  encryptCredentials = encryptSecret,
} = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!destinationStore) return json({ ok: false, reason: 'DESTINATION_STORE_UNAVAILABLE' }, 503);
  const url = new URL(request.url);

  if (url.pathname === '/api/v1/admin/destinations') {
    if (request.method === 'GET') {
      if (!can(authorization, 'sources.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      try {
        const rows = await destinationStore.listDestinations(workspaceId);
        return json({ ok: true, workspaceId, destinations: rows.map(publicDestination) });
      } catch {
        return json({ ok: false, reason: 'DESTINATION_LIST_FAILED' }, 503);
      }
    }
    if (request.method === 'POST') {
      if (!can(authorization, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = parseDestinationInput(body);
      if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      let cipher = null;
      try { cipher = await encryptCredentialPayload(parsed.credentials, env.TRADING_MASTER_KEY, encryptCredentials); } catch { return json({ ok: false, reason: 'DESTINATION_CREDENTIALS_INVALID' }, 400); }
      try {
        const row = await destinationStore.createDestination(workspaceId, parsed.input, cipher);
        return json({ ok: true, workspaceId, destination: publicDestination(row) }, 201);
      } catch {
        return json({ ok: false, reason: 'DESTINATION_CREATE_FAILED' }, 503);
      }
    }
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  if (url.pathname === '/api/v1/admin/templates') {
    if (request.method === 'GET') {
      if (!can(authorization, 'sources.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      try {
        const rows = await destinationStore.listTemplates(workspaceId);
        return json({ ok: true, workspaceId, templates: rows.map(publicTemplate) });
      } catch {
        return json({ ok: false, reason: 'TEMPLATE_LIST_FAILED' }, 503);
      }
    }
    if (request.method === 'POST') {
      if (!can(authorization, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = parseTemplateInput(body);
      if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      try {
        const row = await destinationStore.createTemplate(workspaceId, parsed.input);
        return json({ ok: true, workspaceId, template: publicTemplate(row) }, 201);
      } catch {
        return json({ ok: false, reason: 'TEMPLATE_CREATE_FAILED' }, 503);
      }
    }
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  if (url.pathname === '/api/v1/admin/routes') {
    if (request.method === 'GET') {
      if (!can(authorization, 'sources.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      try {
        const rows = await destinationStore.listRoutes(workspaceId);
        return json({ ok: true, workspaceId, routes: rows.map(publicRoute) });
      } catch {
        return json({ ok: false, reason: 'ROUTE_LIST_FAILED' }, 503);
      }
    }
    if (request.method === 'POST') {
      if (!can(authorization, 'sources.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      const body = await readJson(request);
      if (body === null) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = parseRouteInput(body);
      if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      try {
        const row = await destinationStore.createRoute(workspaceId, parsed.input);
        return json({ ok: true, workspaceId, route: publicRoute(row) }, 201);
      } catch {
        return json({ ok: false, reason: 'ROUTE_CREATE_FAILED' }, 503);
      }
    }
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
  }

  return json({ ok: false, reason: 'ADMIN_DESTINATION_ROUTE_NOT_FOUND' }, 404);
}
