import { createSupabaseTradeStatePersistence } from '../persistence/supabase_trade_state_persistence.js';
import { createV1SimulationDependencies } from '../pipeline/v1_simulation_deps.js';
import { orchestrateTradingEventSimulation } from '../pipeline/v1_orchestrator.js';
import { runV1ProductionExecutionStage } from '../pipeline/v1_execution_stage.js';
import { createBrokerTpProtectionRuntime } from './broker_tp_protection_runtime.js';
import { createProductionExecutionDependencies } from './production_execution_deps_unified.js';

function text(value) { return String(value ?? '').trim(); }
function errorOf(error, label) { if (error) throw new Error(`${label}: ${error.message || 'unknown error'}`); }

async function stableEventKey(candidate, detection) {
  const identity = [candidate.tradeAccountId, candidate.brokerPositionId, candidate.targetIndex, ...detection.dealIds].join(':');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  const hash = [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
  return `broker-tp:${candidate.tradeAccountId}:${candidate.brokerPositionId}:${hash}`;
}

export function createProductionBrokerTpProtectionRuntime({
  persistenceFactory = createSupabaseTradeStatePersistence,
  simulationDepsFactory = createV1SimulationDependencies,
  orchestrateFn = orchestrateTradingEventSimulation,
  executionStageFn = runV1ProductionExecutionStage,
  executionDepsFactory,
  clock = Date.now,
} = {}) {
  return async function run(env = {}) {
    if (env.BROKER_TP_PROTECTION_ENABLED === 'false') return { status: 'disabled', scanned: 0, confirmed: 0, applied: 0, skipped: 0 };
    const persistence = await persistenceFactory(env);
    const supabase = persistence.supabase;
    if (!supabase) throw new Error('broker TP persistence client unavailable');

    async function loadSourceEvent(candidate) {
      if (!candidate.sourceEventId) return null;
      const { data: sourceEvent, error } = await supabase.from('trading_events')
        .select('id,source_connection_id,source_type,source_external_id,external_event_id,occurred_at,metadata')
        .eq('workspace_id', candidate.workspaceId).eq('id', candidate.sourceEventId).maybeSingle();
      errorOf(error, 'source event lookup failed');
      if (!sourceEvent?.source_connection_id) return null;
      const { data: sourceConnection, error: sourceError } = await supabase.from('source_connections')
        .select('id,source_instance_id').eq('workspace_id', candidate.workspaceId)
        .eq('id', sourceEvent.source_connection_id).maybeSingle();
      errorOf(sourceError, 'source connection lookup failed');
      return sourceConnection ? {
        sourceId: String(sourceConnection.id), sourceInstanceId: candidate.sourceInstanceId || sourceConnection.source_instance_id || null,
        sourceEventId: String(sourceEvent.id), sourceType: String(sourceEvent.source_type || 'BROKER'),
        sourceExternalId: String(sourceEvent.source_external_id || sourceEvent.external_event_id || ''),
        metadata: sourceEvent.metadata && typeof sourceEvent.metadata === 'object' ? sourceEvent.metadata : {},
      } : null;
    }

    async function recordManagementEvent({ candidate, detection, sourceEvent, nowMs }) {
      const externalEventId = await stableEventKey(candidate, detection);
      const eventBody = {
        workspace_id: candidate.workspaceId, source_connection_id: sourceEvent.sourceId,
        external_event_id: externalEventId, event_version: '1.0', source_type: sourceEvent.sourceType,
        source_external_id: sourceEvent.sourceExternalId || externalEventId,
        occurred_at: new Date(Number(nowMs)).toISOString(), raw_text: 'Broker take-profit fill detected',
        structured_payload: { kind: 'BROKER_TP_FILL', brokerPositionId: detection.positionId,
          targetIndex: candidate.targetIndex, dealIds: detection.dealIds },
        thread: {}, metadata: { ...sourceEvent.metadata, broker_fill: { kind: 'TAKE_PROFIT',
          tradeAccountId: candidate.tradeAccountId, brokerPositionId: detection.positionId,
          targetIndex: candidate.targetIndex, dealIds: detection.dealIds } },
        processing_status: 'BROKER_TP_DETECTED',
        canonical_intent: { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: candidate.targetIndex,
          brokerPositionId: detection.positionId, tradeAccountId: candidate.tradeAccountId } },
      };
      const { data: inserted, error: insertError } = await supabase.from('trading_events')
        .upsert(eventBody, { onConflict: 'workspace_id,source_connection_id,external_event_id', ignoreDuplicates: true })
        .select('id').maybeSingle();
      errorOf(insertError, 'broker TP event persistence failed');
      let eventId = text(inserted?.id);
      if (!eventId) {
        const { data: existing, error } = await supabase.from('trading_events').select('id')
          .eq('workspace_id', candidate.workspaceId).eq('source_connection_id', sourceEvent.sourceId)
          .eq('external_event_id', externalEventId).maybeSingle();
        errorOf(error, 'broker TP event recovery failed');
        eventId = text(existing?.id);
      }
      if (!eventId) throw new Error('broker TP event id unavailable');
      const event = {
        workspace_hint: candidate.workspaceId, external_event_id: externalEventId,
        source_external_id: sourceEvent.sourceExternalId || externalEventId,
        occurred_at: eventBody.occurred_at, text: eventBody.raw_text,
        structured_payload: eventBody.structured_payload, thread: {},
        source: { instance_id: sourceEvent.sourceInstanceId }, metadata: eventBody.metadata,
      };
      return { eventId, event, sourceId: sourceEvent.sourceId,
        interpretation: eventBody.canonical_intent };
    }

    const depsByWorkspace = new Map();
    const accountLoadById = new Map();
    const runtime = createBrokerTpProtectionRuntime({
      loadCandidates: async () => persistence.listBrokerTpProtectionCandidates({ maxRows: 5000 }),
      loadAccount: async (workspaceId, accountId) => {
        if (!depsByWorkspace.has(workspaceId)) depsByWorkspace.set(workspaceId,
          (executionDepsFactory || createProductionExecutionDependencies)({ env, supabase, workspaceId }));
        const key = `${workspaceId}:${accountId}`;
        if (!accountLoadById.has(key)) accountLoadById.set(key,
          Promise.resolve(depsByWorkspace.get(workspaceId).accountLoader(workspaceId, accountId)));
        return accountLoadById.get(key);
      },
      loadSourceEvent,
      readPositionCloseStatus: async ({ account, candidate, nowMs }) => {
        const workspaceDeps = depsByWorkspace.get(candidate.workspaceId);
        if (typeof workspaceDeps?.readBrokerPositionCloseStatus !== 'function') return null;
        return workspaceDeps.readBrokerPositionCloseStatus({ workspaceId: candidate.workspaceId, account,
          brokerPositionId: candidate.brokerPositionId, symbol: candidate.symbol, side: candidate.side,
          openedAt: candidate.groupCreatedAt ?? candidate.createdAt, nowMs });
      },
      recordManagementEvent,
      applyTargetHit: async ({ candidate, event, sourceEvent }) => {
        const simulationDependencies = await simulationDepsFactory({ env, supabase, event: event.event,
          interpretation: event.interpretation, eventId: event.eventId, sourceId: event.sourceId });
        const simulation = await orchestrateFn({ event: event.event, interpretation: event.interpretation,
          eventId: event.eventId, nowMs: Number(clock()) }, simulationDependencies);
        const result = { ok: true, duplicate: false, eventId: event.eventId, sourceId: sourceEvent?.sourceId,
          event: event.event, interpretation: event.interpretation };
        const execution = await executionStageFn({ env, supabase, result, simulation });
        return { simulation, execution };
      },
      clock,
    });
    try {
      return await runtime(env);
    } finally {
      await Promise.allSettled([...depsByWorkspace.values()].map(async (deps) => {
        if (typeof deps?.finalizeExecutionBatch === 'function') await deps.finalizeExecutionBatch();
      }));
    }
  };
}
