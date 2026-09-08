import { hasTradingPermission } from '../security/trading_permissions.js';
import { canonicalTradingHostsFromEnv } from '../security/trading_hostname_resolver.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(value, max = 160) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}

function color(value) {
  const out = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(out) ? out.toUpperCase() : null;
}

function safeUrl(value) {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch { return null; }
}

function safeBranding(value = {}) {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    brandName: text(v.brandName, 80) || 'Mkety',
    productName: text(v.productName, 100) || 'Trading',
    logoUrl: safeUrl(v.logoUrl),
    accentColor: color(v.accentColor) || '#0F172A',
    supportEmail: text(v.supportEmail, 160),
    supportUrl: safeUrl(v.supportUrl),
    hideMketyBranding: Boolean(v.hideMketyBranding),
  };
}

function parseBranding(input = {}) {
  const candidate = {
    brandName: text(input.brandName, 80),
    productName: text(input.productName, 100),
    logoUrl: input.logoUrl ? safeUrl(input.logoUrl) : null,
    accentColor: input.accentColor ? color(input.accentColor) : null,
    supportEmail: text(input.supportEmail, 160),
    supportUrl: input.supportUrl ? safeUrl(input.supportUrl) : null,
    hideMketyBranding: Boolean(input.hideMketyBranding),
  };
  if (input.logoUrl && !candidate.logoUrl) return { ok: false, reason: 'BRANDING_LOGO_URL_INVALID' };
  if (input.supportUrl && !candidate.supportUrl) return { ok: false, reason: 'BRANDING_SUPPORT_URL_INVALID' };
  if (input.accentColor && !candidate.accentColor) return { ok: false, reason: 'BRANDING_ACCENT_COLOR_INVALID' };
  return { ok: true, branding: safeBranding(candidate) };
}

async function readJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export function createBrandingStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  return {
    async update(workspaceId, metadata) {
      const { data, error } = await supabase
        .from('trading_workspace_access')
        .update({ metadata, updated_at: new Date().toISOString() })
        .eq('id', String(workspaceId))
        .select('*')
        .maybeSingle();
      if (error || !data) throw new Error('BRANDING_UPDATE_FAILED');
      return data;
    },
    async byHostname(hostname) {
      const { data: host, error: hostError } = await supabase
        .from('trading_workspace_hostnames')
        .select('workspace_id,hostname,status')
        .eq('hostname', String(hostname).toLowerCase())
        .eq('status', 'active')
        .maybeSingle();
      if (hostError || !host?.workspace_id) return null;
      const { data: workspace, error } = await supabase
        .from('trading_workspace_access')
        .select('id,display_name,metadata,trading_access_enabled')
        .eq('id', String(host.workspace_id))
        .maybeSingle();
      if (error || !workspace?.id || !workspace.trading_access_enabled) return null;
      return workspace;
    },
  };
}

export async function handleAuthorizedBrandingRequest(request, authorization, { brandingStore } = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  const role = authorization?.membership?.role;
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!brandingStore) return json({ ok: false, reason: 'BRANDING_STORE_UNAVAILABLE' }, 503);
  if (!hasTradingPermission(role, 'branding.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);

  if (request.method === 'GET') {
    return json({ ok: true, workspaceId, branding: safeBranding(authorization.workspace?.metadata?.branding || {}) });
  }
  if (request.method !== 'PATCH') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  if (!hasTradingPermission(role, 'branding.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  const input = await readJson(request);
  if (!input) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
  const parsed = parseBranding(input);
  if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
  const metadata = authorization.workspace?.metadata && typeof authorization.workspace.metadata === 'object'
    ? { ...authorization.workspace.metadata }
    : {};
  metadata.branding = parsed.branding;
  try {
    const workspace = await brandingStore.update(workspaceId, metadata);
    return json({ ok: true, workspaceId, branding: safeBranding(workspace?.metadata?.branding || {}) });
  } catch { return json({ ok: false, reason: 'BRANDING_UPDATE_FAILED' }, 503); }
}

export async function handlePublicBrandingRequest(request, env = {}, { supabase } = {}) {
  if (request.method !== 'GET') return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  const host = new URL(request.url).hostname.toLowerCase();
  const canonical = new Set(canonicalTradingHostsFromEnv(env).map((value) => String(value).toLowerCase()));
  if (canonical.has(host)) return json({ ok: true, kind: 'canonical', branding: safeBranding({}) });
  if (!supabase?.from) return json({ ok: false, reason: 'BRANDING_DATABASE_UNAVAILABLE' }, 503);
  const store = createBrandingStore(supabase);
  const workspace = await store.byHostname(host);
  if (!workspace) return json({ ok: false, reason: 'WHITE_LABEL_HOSTNAME_NOT_ACTIVE' }, 404);
  return json({ ok: true, kind: 'white_label', workspaceId: workspace.id, branding: safeBranding(workspace?.metadata?.branding || { brandName: workspace.display_name }) });
}
