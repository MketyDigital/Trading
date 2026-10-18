import { createPostgrestMigrationClient } from './postgrest_migration_reader.mjs';
import { createSupabaseIngestStores } from '../src/storage/supabase_ingest_store.js';
import { createSourceEventQueue } from '../src/sources/source_event_queue.js';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function isCompleteReadySignal(row = {}) {
  const intent = row.canonical_intent;
  return String(row.processing_status || '').toUpperCase() === 'READY'
    && intent && typeof intent === 'object'
    && intent.incomplete === false
    && Boolean(intent.symbol?.canonical)
    && ['BUY', 'SELL'].includes(String(intent.side || '').toUpperCase())
    && intent.stopLoss != null
    && Array.isArray(intent.takeProfits) && intent.takeProfits.length > 0;
}

async function findGroups(supabase, event) {
  const direct = await supabase.from('position_groups').select('id,runtime_group_id,trade_account_id,status')
    .eq('workspace_id', event.workspace_id).eq('source_event_id', event.id);
  if (direct.error) throw new Error(`Direct group lookup failed: ${direct.error.message}`);
  const linked = await supabase.from('position_groups').select('id,runtime_group_id,trade_account_id,status')
    .eq('workspace_id', event.workspace_id).contains('source_event_ids', [String(event.external_event_id)]);
  if (linked.error) throw new Error(`Linked group lookup failed: ${linked.error.message}`);
  const rows = [...(direct.data || []), ...(linked.data || [])];
  return [...new Map(rows.map((row) => [String(row.id), row])).values()];
}

async function hasActiveBrokerRoute(supabase, event) {
  const routes = await supabase.from('source_destination_routes').select('destination_id')
    .eq('workspace_id', event.workspace_id).eq('source_connection_id', event.source_connection_id).eq('is_active', true);
  if (routes.error) throw new Error(`Route lookup failed: ${routes.error.message}`);
  const destinationIds = [...new Set((routes.data || []).map((row) => String(row.destination_id || '')).filter(Boolean))];
  if (destinationIds.length === 0) return false;
  const destinations = await supabase.from('trading_destinations').select('id')
    .eq('workspace_id', event.workspace_id).eq('destination_type', 'broker_account')
    .eq('is_active', true).in('id', destinationIds).limit(1);
  if (destinations.error) throw new Error(`Broker route lookup failed: ${destinations.error.message}`);
  return Array.isArray(destinations.data) && destinations.data.length > 0;
}

async function requireExecutionControls(supabase) {
  const requiredControls = [
    'trading_access_enabled',
    'broker_execution_enabled',
  ];
  const { data, error } = await supabase.from('trading_runtime_controls')
    .select('control_key,enabled').in('control_key', requiredControls);
  if (error) throw new Error('Trading runtime controls are unavailable');
  const controls = new Map((data || []).map((row) => [String(row.control_key), row.enabled === true]));
  if (requiredControls.some((key) => !controls.has(key))) {
    throw new Error('Trading runtime controls are unavailable');
  }
  if (requiredControls.some((key) => controls.get(key) !== true)) {
    throw new Error('Trading runtime controls block signal recovery');
  }
}

function isWithinRecoveryWindow(value, nowMs) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp)
    && timestamp <= nowMs + 60_000
    && nowMs - timestamp <= 2 * 60 * 60_000;
}

const eventId = required('RECOVERY_EVENT_ID');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
  throw new Error('RECOVERY_EVENT_ID must be a UUID');
}
const supabase = createPostgrestMigrationClient({ url: required('SUPABASE_URL'), serviceRole: required('SUPABASE_SERVICE_ROLE') });
const masterKey = required('TRADING_MASTER_KEY');
const workerBaseUrl = new URL(required('TRADING_WORKER_BASE_URL'));
if (workerBaseUrl.protocol !== 'https:' || workerBaseUrl.username || workerBaseUrl.password) {
  throw new Error('TRADING_WORKER_BASE_URL must be a clean HTTPS URL');
}

const { data: event, error } = await supabase.from('trading_events')
  .select('id,workspace_id,source_connection_id,source_external_id,external_event_id,occurred_at,received_at,raw_text,structured_payload,thread,metadata,processing_status,canonical_intent')
  .eq('id', eventId).maybeSingle();
if (error || !event?.id) throw new Error('Persisted trading event was not found');
if (!event.source_connection_id || !isCompleteReadySignal(event)) {
  throw new Error('Persisted event is not a complete READY signal');
}
await requireExecutionControls(supabase);
if (!(await hasActiveBrokerRoute(supabase, event))) throw new Error('Persisted signal source has no active broker route');
const nowMs = Date.now();
if (!isWithinRecoveryWindow(event.received_at, nowMs) || !isWithinRecoveryWindow(event.occurred_at, nowMs)) {
  throw new Error('Persisted signal is outside the two-hour recovery window');
}
if ((await findGroups(supabase, event)).length > 0) throw new Error('Persisted signal already has a position group');

const stores = createSupabaseIngestStores(supabase, { masterKey });
const transport = createSourceEventQueue({
  sourceStore: stores.sourceStore,
  dispatch: async ({ rawBody, sourceId, timestamp, signature }) => {
    const response = await fetch(new URL('/api/v1/events', workerBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-mkety-source-id': sourceId,
        'x-mkety-timestamp': timestamp,
        'x-mkety-signature': signature,
        'x-mkety-source-recovery': '1',
      },
      body: rawBody,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) throw new Error(`Recovery request failed: HTTP ${response.status}`);
    return body;
  },
});

const result = await transport.consumeSourceEvent({
  sourceId: String(event.source_connection_id),
  event: {
    source_external_id: event.source_external_id,
    external_event_id: event.external_event_id,
    occurred_at: event.occurred_at,
    text: event.raw_text,
    structured_payload: event.structured_payload || {},
    thread: event.thread || {},
    metadata: event.metadata || {},
  },
});

const groups = await findGroups(supabase, event);
if (groups.length === 0) {
  const reason = result?.simulation?.correlation?.reason || result?.simulation?.reason || result?.execution?.reason || 'NO_POSITION_GROUP';
  throw new Error(`Recovery completed without a position group: ${String(reason)}`);
}
if (!groups.some((group) => ['OPEN', 'PENDING'].includes(String(group.status || '').toUpperCase()))) {
  throw new Error('Recovery created no open or pending broker-backed position group');
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  eventId: event.id,
  replayedDuplicate: result.replayedDuplicate === true,
  simulationStatus: result?.simulation?.status || null,
  executionStatus: result?.execution?.status || null,
  correlationReason: result?.simulation?.correlation?.reason || null,
  groups: groups.map((group) => ({ id: group.id, accountId: group.trade_account_id, status: group.status })),
}, null, 2)}\n`);
