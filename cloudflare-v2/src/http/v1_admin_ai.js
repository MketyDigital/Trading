import { encryptSecret, decryptSecret } from '../security/secret_box.js';
import { hasTradingPermission } from '../security/trading_permissions.js';
import { UniversalAIRouter } from '../ai/universal_ai.js';

const PROVIDERS = new Set([
  'openai',
  'azure_openai',
  'gemini',
  'google',
  'vertex_ai',
  'deepseek',
  'groq',
  'cloudflare_ai',
  'workers_ai',
  'aws_bedrock',
  'custom',
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function text(value) { const v = String(value ?? '').trim(); return v || null; }
function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
async function body(request) { try { const v = await request.json(); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } }

function safeProviderConfig(providerName, input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (providerName === 'vertex_ai') {
    const projectId = text(source.projectId ?? source.project_id);
    const location = text(source.location);
    return {
      ...(projectId ? { project_id: projectId } : {}),
      ...(location ? { location } : {}),
    };
  }
  if (providerName === 'aws_bedrock') {
    const region = text(source.region);
    return region ? { region } : {};
  }
  return {};
}

function safeHealthDiagnostic(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const diagnostic = {
    providerId: text(source.providerId),
    providerType: text(source.providerType),
    model: text(source.model),
    outcome: text(source.outcome) || 'FAILED',
    latencyMs: Math.max(0, number(source.latencyMs, 0)),
    retryable: Boolean(source.retryable),
    errorClass: text(source.errorClass),
    sanitizedMessage: text(source.sanitizedMessage),
  };
  const httpStatus = Number(source.httpStatus);
  if (Number.isFinite(httpStatus) && httpStatus > 0) diagnostic.httpStatus = httpStatus;
  const providerCode = text(source.providerCode);
  if (providerCode) diagnostic.providerCode = providerCode;
  return diagnostic;
}

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
    providerConfig: row.provider_config && typeof row.provider_config === 'object' && !Array.isArray(row.provider_config)
      ? row.provider_config
      : {},
    usesBinding: Boolean(row.uses_binding),
    credentialConfigured: Boolean(row.api_key_ciphertext || row.api_key_encrypted || row.api_key),
    lastHealthStatus: row.last_health_status ?? null,
    lastHealthCheckedAt: row.last_health_checked_at ?? null,
    lastHealthDiagnostic: row.last_health_diagnostic && typeof row.last_health_diagnostic === 'object'
      ? safeHealthDiagnostic(row.last_health_diagnostic)
      : null,
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
    async get(workspaceId, id) {
      const { data, error } = await supabase.from('ai_providers').select('*').eq('workspace_id', String(workspaceId)).eq('id', String(id)).maybeSingle();
      if (error) throw new Error('AI_PROVIDER_LOOKUP_FAILED');
      return data || null;
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
    async recordHealth(workspaceId, id, health) {
      const { error } = await supabase.from('ai_providers').update({
        last_health_status: health.status,
        last_health_checked_at: health.checked_at,
        last_health_diagnostic: health.diagnostic,
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', String(workspaceId)).eq('id', String(id));
      if (error) throw new Error('AI_PROVIDER_HEALTH_PERSIST_FAILED');
      return true;
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
  const providerConfig = safeProviderConfig(providerName, input.providerConfig ?? input.provider_config);
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
      provider_config: providerConfig,
      uses_binding: Boolean(input.usesBinding ?? input.uses_binding),
    },
    apiKey: text(input.apiKey ?? input.api_key),
  };
}

async function resolveProviderCredential(provider, env, decryptFn = decryptSecret) {
  if (provider?.api_key_ciphertext) {
    if (!env?.TRADING_MASTER_KEY) throw new Error('AI_ENCRYPTION_NOT_CONFIGURED');
    return decryptFn(provider.api_key_ciphertext, env.TRADING_MASTER_KEY);
  }
  if (typeof provider?.api_key_encrypted === 'string' && provider.api_key_encrypted.startsWith('v1.')) {
    if (!env?.TRADING_MASTER_KEY) throw new Error('AI_ENCRYPTION_NOT_CONFIGURED');
    return decryptFn(provider.api_key_encrypted, env.TRADING_MASTER_KEY);
  }
  return provider?.api_key || provider?.api_key_encrypted || null;
}

async function defaultProviderTester({ workspaceId, provider, env = {}, decryptFn = decryptSecret }) {
  const credential = await resolveProviderCredential(provider, env, decryptFn);
  const router = new UniversalAIRouter([{ ...provider, resolved_api_key: credential }], {
    workspaceId,
    env,
    credentialResolver: async () => credential,
  });
  const result = await router.processSignal('health check', 'Return the single word OK.', { timeoutMs: 8000, purpose: 'health' });
  const diagnostic = result.diagnostics?.[result.diagnostics.length - 1] || {
    providerId: provider.id,
    providerType: provider.provider_name,
    model: provider.model_name,
    outcome: result.success ? 'SUCCESS' : 'FAILED',
    latencyMs: 0,
    retryable: false,
    errorClass: result.success ? null : 'PROVIDER',
    sanitizedMessage: result.success ? null : 'AI provider test failed.',
  };
  return { ok: Boolean(result.success), checkedAt: new Date().toISOString(), diagnostic };
}

export async function handleAuthorizedV1AdminAIRequest(request, authorization, {
  aiStore,
  env = {},
  encryptFn = encryptSecret,
  providerTester = defaultProviderTester,
} = {}) {
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

  const suffix = url.pathname.slice(prefix.length + 1);
  const testMatch = suffix.match(/^([^/]+)\/test$/);
  if (testMatch && request.method === 'POST') {
    let providerId;
    try { providerId = decodeURIComponent(testMatch[1]); } catch { return json({ ok: false, reason: 'AI_PROVIDER_ID_INVALID' }, 400); }
    let provider;
    try { provider = await aiStore.get(workspaceId, providerId); }
    catch { return json({ ok: false, reason: 'AI_PROVIDER_LOOKUP_FAILED' }, 503); }
    if (!provider) return json({ ok: false, reason: 'AI_PROVIDER_NOT_FOUND' }, 404);

    let tested;
    try { tested = await providerTester({ workspaceId, provider, env }); }
    catch { tested = { ok: false, checkedAt: new Date().toISOString(), diagnostic: {
      providerId,
      providerType: provider.provider_name,
      model: provider.model_name,
      outcome: 'FAILED', latencyMs: 0, retryable: false,
      errorClass: 'PROVIDER', sanitizedMessage: 'AI provider test failed.',
    } }; }
    const health = {
      status: tested?.ok ? 'HEALTHY' : 'FAILED',
      checked_at: text(tested?.checkedAt) || new Date().toISOString(),
      diagnostic: safeHealthDiagnostic(tested?.diagnostic),
    };
    try { await aiStore.recordHealth(workspaceId, providerId, health); }
    catch { return json({ ok: false, reason: 'AI_PROVIDER_HEALTH_PERSIST_FAILED' }, 503); }
    return json({ ok: true, workspaceId, providerId, health });
  }

  let id; try { id = decodeURIComponent(suffix); } catch { return json({ ok: false, reason: 'AI_PROVIDER_ID_INVALID' }, 400); }
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
