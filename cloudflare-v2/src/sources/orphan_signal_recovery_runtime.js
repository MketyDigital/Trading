import { createSourceEventQueue } from './source_event_queue.js';
import { createTradingRuntimeControlStore } from '../persistence/supabase_runtime_control_store.js';

const MIN_RETRY_AGE_MS = 2 * 60_000;
const MAX_AGE_MS = 21 * 60_000;
const CANDIDATE_PAGE_SIZE = 50;
const RECOVERY_CURSOR_KEY = 'global_ready_signal_scan_v1';

function millis(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isCompleteSignal(row = {}) {
  const intent = row.canonical_intent;
  return String(row.processing_status || '').toUpperCase() === 'READY'
    && intent && typeof intent === 'object'
    && intent.incomplete === false
    && Boolean(intent.symbol?.canonical)
    && ['BUY', 'SELL'].includes(String(intent.side || '').toUpperCase())
    && intent.stopLoss != null
    && Array.isArray(intent.takeProfits) && intent.takeProfits.length > 0;
}

function isDue(row, nowMs) {
  const receivedAt = millis(row.received_at);
  const occurredAt = millis(row.occurred_at);
  if (receivedAt == null || occurredAt == null) return false;
  const age = Number(nowMs) - receivedAt;
  const sourceAge = Number(nowMs) - occurredAt;
  if (age < -60_000 || sourceAge < -60_000 || age > MAX_AGE_MS || sourceAge > MAX_AGE_MS) return false;
  return age >= MIN_RETRY_AGE_MS;
}

async function defaultSupabaseFactory(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

export async function defaultCandidateLoader({ supabase, nowMs }) {
  const oldest = new Date(Number(nowMs) - MAX_AGE_MS).toISOString();
  const newest = new Date(Number(nowMs) - MIN_RETRY_AGE_MS).toISOString();
  const fields = 'id,workspace_id,source_connection_id,source_external_id,external_event_id,occurred_at,received_at,raw_text,structured_payload,thread,metadata,processing_status,canonical_intent';
  const { data: storedCursor, error: cursorError } = await supabase.from('orphan_signal_recovery_cursors')
    .select('last_received_at,last_event_id').eq('cursor_key', RECOVERY_CURSOR_KEY).maybeSingle();
  if (cursorError) throw new Error(`orphan signal recovery cursor load failed: ${cursorError.message}`);

  const baseQuery = () => supabase.from('trading_events')
    .select(fields)
    .eq('processing_status', 'READY')
    .gte('received_at', oldest)
    .lte('received_at', newest);
  const loadPage = async (cursor) => {
    let query = baseQuery();
    if (cursor?.last_received_at && cursor?.last_event_id) {
      query = query.or(`received_at.gt.${cursor.last_received_at},and(received_at.eq.${cursor.last_received_at},id.gt.${cursor.last_event_id})`);
    }
    return query.order('received_at', { ascending: true }).order('id', { ascending: true }).limit(CANDIDATE_PAGE_SIZE);
  };

  let { data, error } = await loadPage(storedCursor);
  if (error) throw new Error(`orphan signal candidate load failed: ${error.message}`);
  if ((!Array.isArray(data) || data.length === 0) && storedCursor?.last_event_id) {
    ({ data, error } = await loadPage(null));
    if (error) throw new Error(`orphan signal candidate wrap failed: ${error.message}`);
  }
  return { candidates: Array.isArray(data) ? data : [], cursorManaged: true };
}

async function defaultCursorSaver({ supabase, candidate, nowMs }) {
  const { error: saveError } = await supabase.from('orphan_signal_recovery_cursors').upsert({
    cursor_key: RECOVERY_CURSOR_KEY,
    last_received_at: candidate.received_at,
    last_event_id: candidate.id,
    updated_at: new Date(Number(nowMs)).toISOString(),
  }, { onConflict: 'cursor_key' });
  if (saveError) throw new Error(`orphan signal recovery cursor save failed: ${saveError.message}`);
}

async function defaultControlLoader({ supabase }) {
  const store = createTradingRuntimeControlStore(supabase);
  const [tradingAccess, brokerExecution] = await Promise.all([
    store.getTradingAccessEnabled(),
    store.getBrokerExecutionEnabled(),
  ]);
  return { tradingAccess, brokerExecution };
}

function controlStatus(controls = {}) {
  const values = [controls.tradingAccess, controls.brokerExecution];
  if (values.some((control) => control?.ok !== true)) return 'CONTROL_UNAVAILABLE';
  if (values.some((control) => control.enabled !== true)) return 'CONTROL_BLOCKED';
  return 'ENABLED';
}

async function defaultGroupMatcher({ supabase, candidate }) {
  const direct = await supabase.from('position_groups').select('id')
    .eq('workspace_id', candidate.workspace_id).eq('source_event_id', candidate.id).limit(1);
  if (direct.error) throw new Error(`orphan signal direct group lookup failed: ${direct.error.message}`);
  if (Array.isArray(direct.data) && direct.data.length > 0) return true;
  const linked = await supabase.from('position_groups').select('id')
    .eq('workspace_id', candidate.workspace_id).contains('source_event_ids', [String(candidate.external_event_id)]).limit(1);
  if (linked.error) throw new Error(`orphan signal linked group lookup failed: ${linked.error.message}`);
  return Array.isArray(linked.data) && linked.data.length > 0;
}

async function defaultBrokerRouteMatcher({ supabase, candidate }) {
  const routes = await supabase.from('source_destination_routes').select('destination_id')
    .eq('workspace_id', candidate.workspace_id).eq('source_connection_id', candidate.source_connection_id)
    .eq('is_active', true);
  if (routes.error) throw new Error(`orphan signal route lookup failed: ${routes.error.message}`);
  const destinationIds = [...new Set((routes.data || []).map((row) => String(row.destination_id || '')).filter(Boolean))];
  if (destinationIds.length === 0) return false;
  const destinations = await supabase.from('trading_destinations').select('id')
    .eq('workspace_id', candidate.workspace_id).eq('destination_type', 'broker_account')
    .eq('is_active', true).in('id', destinationIds).limit(1);
  if (destinations.error) throw new Error(`orphan signal broker destination lookup failed: ${destinations.error.message}`);
  return Array.isArray(destinations.data) && destinations.data.length > 0;
}

async function defaultEnqueue(env, source, event) {
  return createSourceEventQueue({ queue: env.SOURCE_EVENT_QUEUE }).enqueueSourceEvent(source, event);
}

function nativeEvent(row) {
  return {
    source_external_id: row.source_external_id == null ? null : String(row.source_external_id),
    external_event_id: String(row.external_event_id),
    occurred_at: row.occurred_at == null ? null : String(row.occurred_at),
    text: String(row.raw_text || ''),
    structured_payload: row.structured_payload && typeof row.structured_payload === 'object' ? row.structured_payload : {},
    thread: row.thread && typeof row.thread === 'object' ? row.thread : {},
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  };
}

export function createOrphanSignalRecoveryRuntime({
  supabaseFactory = defaultSupabaseFactory,
  candidateLoader = defaultCandidateLoader,
  cursorSaver = defaultCursorSaver,
  controlLoader = defaultControlLoader,
  groupMatcher = defaultGroupMatcher,
  brokerRouteMatcher = defaultBrokerRouteMatcher,
  enqueueFn = defaultEnqueue,
  clock = Date.now,
} = {}) {
  return async function run(env = {}, { persistenceRuntime = null } = {}) {
    if (env.ORPHAN_SIGNAL_RECOVERY_ENABLED === 'false') {
      return { status: 'DISABLED', scanned: 0, enqueued: 0, skipped: 0, failed: 0 };
    }
    if (!env.SOURCE_EVENT_QUEUE?.send) {
      return { status: 'QUEUE_UNAVAILABLE', scanned: 0, enqueued: 0, skipped: 0, failed: 0 };
    }
    const nowMs = Number(clock());
    const supabase = persistenceRuntime ? null : await supabaseFactory(env);
    let controls;
    try {
      controls = persistenceRuntime
        ? await Promise.all([persistenceRuntime.runtimeControls.getTradingAccessEnabled(), persistenceRuntime.runtimeControls.getBrokerExecutionEnabled()]).then(([tradingAccess, brokerExecution]) => ({ tradingAccess, brokerExecution }))
        : await controlLoader({ supabase });
    } catch {
      return { status: 'CONTROL_UNAVAILABLE', scanned: 0, enqueued: 0, skipped: 0, failed: 0 };
    }
    const controlsStatus = controlStatus(controls);
    if (controlsStatus !== 'ENABLED') {
      return { status: controlsStatus, scanned: 0, enqueued: 0, skipped: 0, failed: 0 };
    }
    const storedCursor = persistenceRuntime ? await persistenceRuntime.recoveryCursors.get(RECOVERY_CURSOR_KEY) : null;
    const oldest = new Date(nowMs - MAX_AGE_MS).toISOString();
    const newest = new Date(nowMs - MIN_RETRY_AGE_MS).toISOString();
    const loaded = persistenceRuntime
      ? { candidates: await persistenceRuntime.ingest.eventStore.listReadyRecoveryCandidates({ oldest, newest, cursor: storedCursor, limit: CANDIDATE_PAGE_SIZE }), cursorManaged: true }
      : await candidateLoader({ supabase, nowMs });
    const cursorManaged = !Array.isArray(loaded) && loaded?.cursorManaged === true;
    const candidates = Array.isArray(loaded) ? loaded : (Array.isArray(loaded?.candidates) ? loaded.candidates : []);
    let enqueued = 0;
    let skipped = 0;
    let failed = 0;
    let firstFailedIndex = -1;
    for (const [index, candidate] of candidates.entries()) {
      if (!candidate?.id || !candidate?.workspace_id || !candidate?.source_connection_id
        || !candidate?.external_event_id || !isCompleteSignal(candidate) || !isDue(candidate, nowMs)) {
        skipped += 1;
        continue;
      }
      try {
        const routed = persistenceRuntime
          ? await (async () => {
              const [routes, destinations] = await Promise.all([persistenceRuntime.routes.list(candidate.workspace_id), persistenceRuntime.destinations.listDestinations(candidate.workspace_id)]);
              const destinationById = new Map(destinations.map(item => [String(item.id), item]));
              return routes.some(route => String(route.source_connection_id) === String(candidate.source_connection_id)
                && (route.is_active === true || Number(route.is_active) === 1)
                && destinationById.get(String(route.destination_id))?.destination_type === 'broker_account'
                && (destinationById.get(String(route.destination_id))?.is_active === true || Number(destinationById.get(String(route.destination_id))?.is_active) === 1));
            })()
          : await brokerRouteMatcher({ supabase, candidate });
        if (!routed) {
          skipped += 1;
          continue;
        }
        const alreadyGrouped = persistenceRuntime
          ? await persistenceRuntime.tradeState.hasSourceEventGroup(candidate.workspace_id, candidate.id, candidate.external_event_id)
          : await groupMatcher({ supabase, candidate });
        if (alreadyGrouped) {
          skipped += 1;
          continue;
        }
        await enqueueFn(env, { id: String(candidate.source_connection_id) }, nativeEvent(candidate));
        enqueued += 1;
      } catch (error) {
        console.warn('Orphan signal recovery failed:', error?.message || error);
        failed += 1;
        if (firstFailedIndex < 0) firstFailedIndex = index;
      }
    }
    if (cursorManaged && candidates.length > 0) {
      const committedIndex = firstFailedIndex < 0 ? candidates.length - 1 : firstFailedIndex - 1;
      if (committedIndex >= 0) {
        if (persistenceRuntime) await persistenceRuntime.recoveryCursors.save(RECOVERY_CURSOR_KEY, candidates[committedIndex].received_at, candidates[committedIndex].id);
        else await cursorSaver({ supabase, candidate: candidates[committedIndex], nowMs });
      }
    }
    return { status: 'COMPLETED', scanned: candidates.length, enqueued, skipped, failed };
  };
}
