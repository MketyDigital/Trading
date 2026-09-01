import { ingestTradingEvent } from '../pipeline/ingest.js';
import { createSupabaseIngestStores } from '../storage/supabase_ingest_store.js';
import { createWorkspaceAIRouter } from '../ai/workspace_ai.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function defaultSupabaseFactory(env) {
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE || env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

export async function handleV1EventsRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  storesFactory = createSupabaseIngestStores,
  workspaceAiFactory = createWorkspaceAIRouter,
  ingestFn = ingestTradingEvent,
} = {}) {
  if (request.method !== 'POST') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const sourceId = request.headers.get('X-Mkety-Source-Id');
  const timestamp = request.headers.get('X-Mkety-Timestamp');
  const signature = request.headers.get('X-Mkety-Signature');
  if (!sourceId || !timestamp || !signature) {
    return json({ ok: false, reason: 'MISSING_SOURCE_AUTH_HEADERS' }, 401);
  }

  const masterKey = env.TRADING_MASTER_KEY;
  if (!masterKey) {
    return json({ ok: false, reason: 'TRADING_MASTER_KEY_NOT_CONFIGURED' }, 503);
  }

  try {
    const rawBody = await request.text();
    const supabase = await supabaseFactory(env);
    const stores = storesFactory(supabase, { masterKey });
    const interpretationTimeoutMs = Math.max(100, Number(env.TRADING_V1_AI_TIMEOUT_MS || 800));

    const result = await ingestFn({
      rawBody,
      sourceId,
      timestamp,
      signature,
    }, {
      ...stores,
      interpretationTimeoutMs,
      aiRouterFactory: ({ source }) => workspaceAiFactory(supabase, source.workspace_id, {
        masterKey,
        env,
      }),
    });

    return json(result, result?.ok ? 200 : Number(result?.status || 500));
  } catch (error) {
    console.error('V1 event ingress failed:', error);
    return json({ ok: false, reason: 'V1_INGRESS_INTERNAL_ERROR' }, 500);
  }
}
