import { encryptSecret } from '../security/secret_box.js';
import { hasTradingPermission } from '../security/trading_permissions.js';

const PROVIDERS = new Set(['openai','gemini','google','deepseek','groq','cloudflare_ai','workers_ai','custom']);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(value) { const v = String(value ?? '').trim(); return v || null; }
function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
async function body(request) { try { const v = await request.json(); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } }
function publicProvider(row = {}) {
  return {
    id: row.id,
    providerName: row.provider_name,
    modelName: row.model_name,
    baseUrl: row.base_url ?? null,
    priority: Number(row.priority_rank ?? 1),
    active: Boolean(row.is_active),
    temperature: Number(row.temperature ?? 0.1),
    maxOutputTokens: Number(row.max_output_tokens ?? 1000),
    accountId: row.account_id ?? null,
    usesBinding: Boolean(row.uses_binding),
    credentialConfigured: Boolean(row.api_key_ciphertext || row.api_key_encrypted || row.api_key),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function createAdminAIStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  return {
    async list(workspaceId) {
      const { data, error } = await supabase.from('ai_providers').select('*').eq('workspace_id', String(workspaceId)).order('priority_rank', { ascending: true });
      if (error) throw new Error('AI_PROVIDER_LIST_FAILED');
      return data || [];
    },
    async create(workspaceId, input) {
      const { data, error } = await supabase.from('ai_providers').insert({ workspace_id: String(workspaceId), ...input }).select('*').maybeSingle();
      if (error || !data) throw new Error('AI_PROVIDER_CREATE_FAILED');
      return data;
    },
    async update(workspaceId, id, input) {
      const { data, error } = await supabase.from('ai_providers').update({ ...input, updated_at: new Date().toISOString() }).eq('workspace_id', String(workspaceId)).eq('id', String(id)).select('*').maybeSingle();
      if (error) throw new Error('AI_PROVIDER_UPDATE_FAILED');
      return data || null;
    },
    async remove(workspaceId, id) {
      const { error } = await supabase.from('ai_providers').delete().eq('workspace_id', String(workspaceId)).eq('id', String(id));
      if (error) throw new Error('AI_PROVIDER_DELETE_FAILED');
      return true;
    },
  };
}

function parse(input = {}) {
  const providerName = text(input.providerName ?? input.provider_name)?.toLowerCase();
  const modelName = text(input.modelName ?? input.model_name);
  if (!providerName || !PROVIDERS.has(providerName) || !modelName) return { ok: false, reason: 'AI_PROVIDER_CONFIGURATION_INVALID' };
  return {
    ok: true,
    value: {
      provider_name: providerName,
      model_name: modelName,
      base_url: text(input.baseUrl ?? input.base_url),
      priority_rank: Math.max(1, Math.trunc(number(input.priority ?? input.priority_rank, 1))),
      is_active: input.active === undefined ? true : Boolean(input.active),
      temperature: Math.max(0, Math.min(2, number(input.temperature, 0.1))),
      max_output_tokens: Math.max(64, Math.min(32000, Math.trunc(number(input.maxOutputTokens ?? input.max_output_tokens, 1000)))),
      account_id: text(input.accountId ?? input.account_id),
      uses_binding: Boolean(input.usesBinding ?? input.uses_binding),
    },
    apiKey: text(input.apiKey ?? input.api_key),
  };
}

export async function handleAuthorizedV1AdminAIRequest(request, authorization, { aiStore, env = {}, encryptFn = encryptSecret } = {}) {
  const workspaceId = String(authorization?.workspace?.id ?? '').trim();
  if (!workspaceId) return json({ ok: false, reason: 'ADMIN_WORKSPACE_AUTHORITY_MISSING' }, 403);
  if (!aiStore) return json({ ok: false, reason: 'AI_PROVIDER_STORE_UNAVAILABLE' }, 503);
  const role = authorization?.membership?.role;
  if (!hasTradingPermission(role, 'ai.read')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);

  const url = new URL(request.url);
  const prefix = '/api/v1/admin/ai-providers';
  if (url.pathname === prefix) {
    if (request.method === 'GET') {
      try { return json({ ok: true, workspaceId, providers: (await aiStore.list(workspaceId)).map(publicProvider) }); }
      catch { return json({ ok: false, reason: 'AI_PROVIDER_LIST_FAILED' }, 503); }
    }
    if (request.method === 'POST') {
      if (!hasTradingPermission(role, 'ai.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
      const input = await body(request); if (!input) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
      const parsed = parse(input); if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
      const row = { ...parsed.value };
      if (parsed.apiKey) {
        if (!env.TRADING_MASTER_KEY) return json({ ok: false, reason: 'AI_ENCRYPTION_NOT_CONFIGURED' }, 503);
        try { row.api_key_ciphertext = await encryptFn(parsed.apiKey, env.TRADING_MASTER_KEY); }
        catch { return json({ ok: false, reason: 'AI_CREDENTIAL_INVALID' }, 400); }
      } else if (!row.uses_binding) {
        return json({ ok: false, reason: 'AI_CREDENTIAL_REQUIRED' }, 400);
      }
      try { return json({ ok: true, workspaceId, provider: publicProvider(await aiStore.create(workspaceId, row)) }, 201); }
      catch { return json({ ok: false, reason: 'AI_PROVIDER_CREATE_FAILED' }, 503); }
    }
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  }

  if (!url.pathname.startsWith(prefix + '/')) return json({ ok: false, reason: 'AI_PROVIDER_ROUTE_NOT_FOUND' }, 404);
  if (!hasTradingPermission(role, 'ai.write')) return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  let id; try { id = decodeURIComponent(url.pathname.slice(prefix.length + 1)); } catch { return json({ ok: false, reason: 'AI_PROVIDER_ID_INVALID' }, 400); }
  if (!id) return json({ ok: false, reason: 'AI_PROVIDER_ID_INVALID' }, 400);

  if (request.method === 'PUT') {
    const input = await body(request); if (!input) return json({ ok: false, reason: 'INVALID_JSON' }, 400);
    const parsed = parse(input); if (!parsed.ok) return json({ ok: false, reason: parsed.reason }, 400);
    const row = { ...parsed.value };
    if (parsed.apiKey) {
      if (!env.TRADING_MASTER_KEY) return json({ ok: false, reason: 'AI_ENCRYPTION_NOT_CONFIGURED' }, 503);
      try { row.api_key_ciphertext = await encryptFn(parsed.apiKey, env.TRADING_MASTER_KEY); }
      catch { return json({ ok: false, reason: 'AI_CREDENTIAL_INVALID' }, 400); }
    }
    try {
      const provider = await aiStore.update(workspaceId, id, row);
      if (!provider) return json({ ok: false, reason: 'AI_PROVIDER_NOT_FOUND' }, 404);
      return json({ ok: true, workspaceId, provider: publicProvider(provider) });
    } catch { return json({ ok: false, reason: 'AI_PROVIDER_UPDATE_FAILED' }, 503); }
  }
  if (request.method === 'DELETE') {
    try { await aiStore.remove(workspaceId, id); return json({ ok: true, workspaceId }); }
    catch { return json({ ok: false, reason: 'AI_PROVIDER_DELETE_FAILED' }, 503); }
  }
  return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
}
