import { ingestTradingEvent } from '../pipeline/ingest.js';
import { orchestrateTradingEventSimulation } from '../pipeline/v1_orchestrator.js';
import { createV1SimulationDependencies } from '../pipeline/v1_simulation_deps.js';
import { runV1ProductionExecutionStage } from '../pipeline/v1_execution_stage.js';
import { createProductionExecutionDependencies } from '../execution/production_execution_deps_unified.js';
import { executeProductionPlan } from '../execution/production_execution_coordinator.js';
import { createSupabaseIngestStores } from '../storage/supabase_ingest_store.js';
import { createWorkspaceAIRouter } from '../ai/workspace_ai.js';
import { createProviderCircuitBreaker } from '../resilience/provider_circuit_breaker.js';
import { decryptSecret } from '../security/secret_box.js';
import { normalizeDestinationCredentialPlaintext } from '../destinations/destination_credentials_compat.js';
import { createTelegramDestinationAiFormatter } from '../destinations/telegram_ai_formatter.js';
import {
  createV1DestinationDeliveryStore,
  runV1DestinationDeliveryStage,
} from '../destinations/v1_destination_delivery_stage.js';

const ambiguityAiCircuitBreaker = createProviderCircuitBreaker();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function blockedSimulation() {
  return {
    status: 'BLOCKED',
    executionEnabled: false,
    actions: [],
    error: 'simulation context unavailable',
  };
}

function blockedDestinationStage() {
  return {
    status: 'BLOCKED',
    succeeded: 0,
    failed: 0,
    rejected: 0,
    blocked: 0,
    outcomes: [],
    errorCode: 'DESTINATION_STAGE_FAILED',
  };
}

function skippedDuplicateDestinationStage() {
  return {
    status: 'SKIPPED_DUPLICATE',
    succeeded: 0,
    failed: 0,
    rejected: 0,
    blocked: 0,
    outcomes: [],
  };
}

async function defaultSupabaseFactory(env) {
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE || env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

async function decryptDestinationCredentialsCompat(ciphertext, masterKey) {
  const plaintext = await decryptSecret(ciphertext, masterKey);
  return normalizeDestinationCredentialPlaintext(plaintext);
}

export async function handleV1EventsRequest(request, env = {}, {
  supabaseFactory = defaultSupabaseFactory,
  storesFactory = createSupabaseIngestStores,
  workspaceAiFactory = createWorkspaceAIRouter,
  aiCircuitBreaker = ambiguityAiCircuitBreaker,
  ingestFn = ingestTradingEvent,
  simulationDepsFactory = createV1SimulationDependencies,
  orchestrateFn = orchestrateTradingEventSimulation,
  executionStageFn = runV1ProductionExecutionStage,
  executionDepsFactory = createProductionExecutionDependencies,
  executeProductionFn = executeProductionPlan,
  tradingAccessControlResolver,
  brokerExecutionControlResolver,
  destinationStoreFactory = createV1DestinationDeliveryStore,
  destinationStageFn = runV1DestinationDeliveryStage,
  orchestrateDuplicates = false,
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
    let workspaceAiRouterPromise = null;
    let workspaceAiRouterWorkspaceId = null;
    const aiRouterForWorkspace = (workspaceId) => {
      const trustedWorkspaceId = String(workspaceId ?? '').trim();
      if (!trustedWorkspaceId) return Promise.resolve(null);
      if (!workspaceAiRouterPromise || workspaceAiRouterWorkspaceId !== trustedWorkspaceId) {
        workspaceAiRouterWorkspaceId = trustedWorkspaceId;
        workspaceAiRouterPromise = Promise.resolve(workspaceAiFactory(supabase, trustedWorkspaceId, {
          masterKey,
          env,
          circuitBreaker: aiCircuitBreaker,
        }));
      }
      return workspaceAiRouterPromise;
    };

    const result = await ingestFn({
      rawBody,
      sourceId,
      timestamp,
      signature,
    }, {
      ...stores,
      interpretationTimeoutMs,
      aiRouterFactory: ({ source }) => aiRouterForWorkspace(source.workspace_id),
    });

    const recoveryReplay = request.headers.get('X-Mkety-Source-Recovery') === '1';
    const duplicateReplayRequested = orchestrateDuplicates || recoveryReplay;
    const allowDuplicateOrchestration = duplicateReplayRequested && result?.recoveryReady === true;
    if (!result?.ok || (result?.duplicate && !allowDuplicateOrchestration)) {
      const responseBody = result?.ok && result?.duplicate
        ? { ...result, destinations: skippedDuplicateDestinationStage() }
        : result;
      return json(responseBody, result?.ok ? 200 : Number(result?.status || 500));
    }

    // Destination delivery is independent of broker planning/execution. Start it
    // immediately, but contain all destination failures inside this branch so a
    // slow or failing Telegram/webhook destination cannot delay broker dispatch.
    const destinationPromise = result?.duplicate
      ? Promise.resolve(skippedDuplicateDestinationStage())
      : (async () => {
          try {
            const destinationStore = destinationStoreFactory(supabase, { masterKey });
            const aiFormatterFactory = async () => {
              const router = await aiRouterForWorkspace(result?.event?.workspace_hint);
              return createTelegramDestinationAiFormatter(router);
            };
            return await destinationStageFn({
              workspaceId: result?.event?.workspace_hint,
              sourceId,
              event: result.event,
              interpretation: result.interpretation,
              env,
            }, {
              destinationStore,
              decryptCredentials: decryptDestinationCredentialsCompat,
              aiFormatterFactory,
              aiCircuitBreaker,
            });
          } catch {
            return blockedDestinationStage();
          }
        })();

    let simulation;
    try {
      const dependencies = await simulationDepsFactory({
        env,
        supabase,
        event: result.event,
        interpretation: result.interpretation,
        eventId: result.eventId,
        sourceId,
      });
      simulation = await orchestrateFn({
        event: result.event,
        interpretation: result.interpretation,
        eventId: result.eventId,
      }, dependencies);
    } catch (error) {
      console.warn('V1 simulation planning blocked:', error?.message || error);
      simulation = blockedSimulation();
    }

    const executionResult = result?.duplicate && allowDuplicateOrchestration
      ? { ...result, duplicate: false, replayedDuplicate: true }
      : result;
    const execution = await executionStageFn({
      env,
      supabase,
      result: executionResult,
      simulation,
      executionDepsFactory,
      executeProductionFn,
      ...(tradingAccessControlResolver ? { tradingAccessControlResolver } : {}),
      ...(brokerExecutionControlResolver ? { brokerExecutionControlResolver } : {}),
    });

    const destinations = await destinationPromise;
    return json({ ...result, destinations, simulation, ...(execution ? { execution } : {}) }, 200);
  } catch (error) {
    console.error('V1 event ingress failed:', error);
    return json({ ok: false, reason: 'V1_INGRESS_INTERNAL_ERROR' }, 500);
  }
}
