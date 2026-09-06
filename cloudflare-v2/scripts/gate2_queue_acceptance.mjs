import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { encryptSecret } from '../src/security/secret_box.js';
import { buildSignedV1Request } from '../src/testing/v1_acceptance_harness.js';

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const supabaseUrl = required('SUPABASE_URL');
const serviceRole = required('SUPABASE_SERVICE_ROLE');
const masterKey = required('TRADING_MASTER_KEY');
const sourceSecret = required('TRADING_V1_SOURCE_SECRET');
const internalToken = required('INTERNAL_SOURCE_TRANSPORT_TOKEN');
const workerBaseUrl = required('TRADING_V1_WORKER_BASE_URL').replace(/\/$/, '');

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const workspaceId = randomUUID();
const sourceId = randomUUID();
const accountId = randomUUID();
const ownerEmail = `gate2-${workspaceId}@invalid.local`;
const queueExternalEventId = 'telegram:-1000000000001:1';
const blockedExternalEventId = `gate2-external-blocked-${randomUUID()}`;

async function requireDb(result, label) {
  if (result?.error) throw new Error(`${label}: ${result.error.message || result.error.code || 'database error'}`);
  return result?.data;
}

async function setupFixture() {
  const [sourceCiphertext, brokerPlaceholderCiphertext] = await Promise.all([
    encryptSecret(sourceSecret, masterKey),
    encryptSecret(`gate2-no-live-broker-credential-${randomUUID()}`, masterKey),
  ]);

  await requireDb(await supabase.from('workspaces').insert({
    id: workspaceId,
    name: 'Gate 2 Temporary Staging',
    owner_email: ownerEmail,
    tier: 'free',
  }), 'create legacy-compatible staging workspace');

  await requireDb(await supabase.from('trading_workspace_access').insert({
    id: workspaceId,
    display_name: 'Gate 2 Temporary Staging',
    owner_email: ownerEmail,
    trading_access_enabled: false,
    metadata: { gate2_acceptance: true, temporary: true },
  }), 'create Trading staging workspace');

  await requireDb(await supabase.from('source_connections').insert({
    id: sourceId,
    workspace_id: workspaceId,
    source_type: 'telegram_mtproto',
    source_instance_id: 'gate2-external-mtproto',
    display_name: 'Gate 2 Temporary External MTProto',
    secret_ciphertext: sourceCiphertext,
    settings: {},
    is_active: true,
    source_family: 'telegram',
    provider_type: 'external_mtproto',
    is_default: false,
    priority: 100,
    external_identity: 'gate2-account',
    config: {
      chat_acceptance_mode: 'allowlist',
      allowed_chat_ids: ['-1000000000001'],
    },
    health_status: 'HEALTHY',
  }), 'create temporary source');

  await requireDb(await supabase.from('trade_accounts').insert({
    id: accountId,
    workspace_id: workspaceId,
    account_label: 'Gate 2 Simulation Only',
    platform: 'mt5',
    account_id: `gate2-simulation-${accountId}`,
    api_token_encrypted: brokerPlaceholderCiphertext,
    lot_sizing_type: 'fixed',
    lot_value: 0.03,
    is_active: true,
    execution_enabled: true,
    safety_policy: {
      enabled: true,
      killSwitch: false,
      allowedSymbols: ['XAUUSD'],
      maxLotsPerTrade: 1,
    },
    fast_entry_policy: 'wait_for_complete_signal',
    entry_zone_policy: 'nearest_boundary',
  }), 'create temporary simulation account');
}

async function postInternalQueueEvent() {
  const response = await fetch(`${workerBaseUrl}/api/v1/internal/source-event`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mkety-internal-source-token': internalToken,
    },
    body: JSON.stringify({
      source_id: sourceId,
      source_external_id: 'gate2-account',
      external_event_id: queueExternalEventId,
      occurred_at: new Date().toISOString(),
      text: 'BUY XAUUSD 2500 SL 2490 TP 2510 2520 2530',
      structured_payload: {},
      thread: {},
      metadata: {
        gate2_acceptance: true,
        native_identity: {
          chat_id: '-1000000000001',
          message_id: '1',
        },
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 202 && body?.ok === true && body?.queued === true, `queue ingress failed with HTTP ${response.status}`);
}

async function waitForSingleQueuedEvent() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('trading_events')
      .select('id,processing_status,canonical_event_id,external_event_id,source_connection_id')
      .eq('workspace_id', workspaceId)
      .eq('external_event_id', queueExternalEventId);
    if (error) throw new Error(`queue verification query failed: ${error.message}`);
    if (Array.isArray(data) && data.length === 1 && data[0]?.processing_status === 'READY') return data[0];
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('queue consumer did not persist exactly one READY event within 60 seconds');
}

async function proveExternalTradingAccessFailsClosed() {
  const event = {
    version: '1.0',
    source: { type: 'telegram_mtproto', instance_id: 'gate2-external-mtproto', external_id: 'gate2-account' },
    external_event_id: blockedExternalEventId,
    occurred_at: new Date().toISOString(),
    received_at: new Date().toISOString(),
    text: 'BUY XAUUSD 2500 SL 2490 TP 2510 2520 2530',
    structured_payload: {},
    thread: {},
    metadata: {
      gate2_acceptance: true,
      external_access_fail_closed_probe: true,
      native_identity: {
        chat_id: '-1000000000001',
        message_id: '2',
      },
    },
  };

  const { request } = await buildSignedV1Request({
    endpoint: `${workerBaseUrl}/api/v1/events`,
    sourceId,
    secret: sourceSecret,
    event,
  });
  const response = await fetch(request);
  const body = await response.json().catch(() => ({}));
  assert(response.status === 503, `external Trading access must fail closed with HTTP 503, got ${response.status}`);
  assert(body?.ok === false && body?.reason === 'TRADING_ACCESS_DISABLED', 'external Trading access must fail closed as TRADING_ACCESS_DISABLED');
}

async function verifyQueueDeduplication() {
  const { data, error } = await supabase
    .from('trading_events')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('external_event_id', queueExternalEventId);
  if (error) throw new Error(`deduplication verification query failed: ${error.message}`);
  assert(Array.isArray(data) && data.length === 1, 'duplicate queued source event must collapse to exactly one persistent Trading Event');
}

async function verifyNoBrokerDelivery() {
  const { data, error } = await supabase
    .from('destination_deliveries')
    .select('id,status,destination_type')
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(`broker delivery verification query failed: ${error.message}`);
  assert(Array.isArray(data) && data.length === 0, 'Gate 2 must create zero broker/destination delivery rows while broker execution is disabled');
}

async function cleanupFixture() {
  const operations = [
    ['destination_deliveries', supabase.from('destination_deliveries').delete().eq('workspace_id', workspaceId)],
    ['trading_events', supabase.from('trading_events').delete().eq('workspace_id', workspaceId)],
    ['source_connections', supabase.from('source_connections').delete().eq('id', sourceId)],
    ['trade_accounts', supabase.from('trade_accounts').delete().eq('id', accountId)],
    ['trading_workspace_access', supabase.from('trading_workspace_access').delete().eq('id', workspaceId)],
    ['workspaces', supabase.from('workspaces').delete().eq('id', workspaceId)],
  ];
  const failures = [];
  for (const [label, operation] of operations) {
    const { error } = await operation;
    if (error) failures.push(`${label}: ${error.message || error.code}`);
  }
  if (failures.length) throw new Error(`Gate 2 fixture cleanup failed: ${failures.join('; ')}`);
}

let primaryError = null;
try {
  await setupFixture();
  await postInternalQueueEvent();
  await postInternalQueueEvent();
  const queued = await waitForSingleQueuedEvent();
  assert(queued?.source_connection_id === sourceId, 'queued event must remain bound to the temporary source');
  await verifyQueueDeduplication();
  await proveExternalTradingAccessFailsClosed();
  await verifyNoBrokerDelivery();
  console.log(JSON.stringify({
    ok: true,
    gate: 2,
    queue: { acceptedTwice: true, persistentCount: 1, processingStatus: 'READY' },
    externalTradingAccess: { enabled: false, failClosed: true, status: 503 },
    brokerDelivery: { count: 0, executionEnabled: false },
    brokerExecution: false,
  }));
} catch (error) {
  primaryError = error;
  console.error(`Gate 2 acceptance failed: ${error?.message || error}`);
} finally {
  try {
    await cleanupFixture();
  } catch (cleanupError) {
    console.error(cleanupError?.message || cleanupError);
    if (!primaryError) primaryError = cleanupError;
  }
}

if (primaryError) process.exitCode = 1;