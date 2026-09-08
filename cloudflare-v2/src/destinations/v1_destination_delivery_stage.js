import { decryptSecret } from '../security/secret_box.js';
import { formatTelegramDestinationMessage } from './formatting.js';
import { sendTelegramDestination } from './telegram_destination.js';

const DESTINATION_SELECT = [
  'id', 'workspace_id', 'destination_type', 'display_name', 'destination_ref', 'template_id',
  'credential_ciphertext', 'settings', 'is_active', 'health_status',
].join(',');

const TEMPLATE_SELECT = [
  'id', 'workspace_id', 'template_name', 'formatting_mode', 'parse_mode', 'brand_name', 'header',
  'footer', 'disclaimer', 'emoji_style', 'cleanup_rules', 'layout', 'is_default',
].join(',');

function text(value) {
  return String(value ?? '').trim();
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeErrorCode(value, fallback) {
  const code = text(value).toUpperCase().replace(/[^A-Z0-9_:-]/g, '_').slice(0, 96);
  return code || fallback;
}

function normalizeCredentialEnvelope(plaintext) {
  let parsed;
  try {
    parsed = JSON.parse(String(plaintext ?? ''));
  } catch {
    throw new Error('DESTINATION_CREDENTIALS_INVALID');
  }
  if (parsed?.version !== 1 || parsed?.kind !== 'destination' || !parsed?.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
    throw new Error('DESTINATION_CREDENTIALS_INVALID');
  }
  return parsed.data;
}

function destinationId(row = {}) {
  return text(row.id ?? row.destinationId ?? row.destination_id);
}

function destinationWorkspace(row = {}) {
  return text(row.workspace_id ?? row.workspaceId);
}

function destinationType(row = {}) {
  return text(row.destination_type ?? row.destinationType ?? row.type).toLowerCase();
}

function active(row = {}) {
  return (row.is_active ?? row.enabled) === true;
}

function publicOutcome(destination, status, extra = {}) {
  return {
    destinationId: destinationId(destination),
    destinationType: destinationType(destination),
    status,
    ...extra,
  };
}

function stageSummary(outcomes = []) {
  const succeeded = outcomes.filter((item) => item.status === 'SUCCEEDED').length;
  const failed = outcomes.filter((item) => item.status === 'FAILED').length;
  const rejected = outcomes.filter((item) => item.status === 'REJECTED').length;
  const blocked = outcomes.filter((item) => item.status === 'BLOCKED').length;
  let status = 'NO_DESTINATIONS';
  if (succeeded && !failed && !rejected && !blocked) status = 'DELIVERED';
  else if (succeeded) status = 'PARTIAL_FAILURE';
  else if (failed || rejected || blocked) status = failed ? 'FAILED' : 'BLOCKED';
  return { status, succeeded, failed, rejected, blocked, outcomes };
}

export function createV1DestinationDeliveryStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  return {
    async listRoutedDestinations(workspaceId, sourceId) {
      const workspace = text(workspaceId);
      const source = text(sourceId);
      const { data: routes, error: routesError } = await supabase
        .from('source_destination_routes')
        .select('destination_id,priority')
        .eq('workspace_id', workspace)
        .eq('source_connection_id', source)
        .eq('is_active', true)
        .order('priority', { ascending: true });
      if (routesError) throw new Error('DESTINATION_ROUTE_LIST_FAILED');
      if (!routes?.length) return [];

      const orderedIds = routes.map((row) => text(row.destination_id)).filter(Boolean);
      if (!orderedIds.length) return [];
      const { data: destinations, error: destinationError } = await supabase
        .from('trading_destinations')
        .select(DESTINATION_SELECT)
        .eq('workspace_id', workspace)
        .eq('is_active', true)
        .in('id', orderedIds);
      if (destinationError) throw new Error('DESTINATION_LIST_FAILED');

      const destinationRows = new Map((destinations || []).map((row) => [text(row.id), row]));
      const templateIds = [...new Set((destinations || []).map((row) => text(row.template_id)).filter(Boolean))];
      let templates = [];
      if (templateIds.length) {
        const { data, error } = await supabase
          .from('trading_destination_templates')
          .select(TEMPLATE_SELECT)
          .eq('workspace_id', workspace)
          .in('id', templateIds);
        if (error) throw new Error('DESTINATION_TEMPLATE_LIST_FAILED');
        templates = data || [];
      }
      const templateRows = new Map(templates.map((row) => [text(row.id), row]));

      return orderedIds
        .map((id) => destinationRows.get(id))
        .filter(Boolean)
        .map((row) => ({ ...row, template: templateRows.get(text(row.template_id)) || null }));
    },

    async recordDestinationOutcome(workspaceId, id, outcome = {}) {
      const succeeded = outcome.status === 'SUCCEEDED';
      const patch = {
        health_status: succeeded ? 'HEALTHY' : outcome.status === 'BLOCKED' ? 'BLOCKED' : 'DEGRADED',
        last_error_code: succeeded ? null : text(outcome.errorCode) || outcome.status,
      };
      if (succeeded) patch.last_delivery_at = new Date().toISOString();
      const { error } = await supabase
        .from('trading_destinations')
        .update(patch)
        .eq('workspace_id', text(workspaceId))
        .eq('id', text(id));
      if (error) throw new Error('DESTINATION_OUTCOME_UPDATE_FAILED');
    },
  };
}

async function safeRecord(destinationStore, workspaceId, destination, outcome) {
  try {
    await destinationStore?.recordDestinationOutcome?.(workspaceId, destinationId(destination), outcome);
  } catch {
    // Delivery telemetry must never change delivery outcome or break ingress.
  }
}

async function deliverTelegram({ workspaceId, destination, event, interpretation, env }, deps) {
  if (!destination.credential_ciphertext) {
    return publicOutcome(destination, 'FAILED', { errorCode: 'DESTINATION_CREDENTIALS_MISSING' });
  }
  if (!text(destination.destination_ref)) {
    return publicOutcome(destination, 'FAILED', { errorCode: 'DESTINATION_REF_MISSING' });
  }

  let credentials;
  try {
    const plaintext = await deps.decryptCredentials(destination.credential_ciphertext, env.TRADING_MASTER_KEY);
    credentials = normalizeCredentialEnvelope(plaintext);
  } catch {
    return publicOutcome(destination, 'FAILED', { errorCode: 'DESTINATION_CREDENTIALS_INVALID' });
  }
  const botToken = text(credentials.botToken ?? credentials.bot_token);
  if (!botToken) return publicOutcome(destination, 'FAILED', { errorCode: 'TELEGRAM_BOT_TOKEN_MISSING' });

  const template = safeObject(destination.template);
  const formatted = deps.formatTelegram({
    mode: template.formatting_mode ?? template.formattingMode ?? 'template',
    rawText: event?.text ?? '',
    interpretation,
  }, template);
  if (!formatted?.ok) {
    return publicOutcome(destination, 'FAILED', { errorCode: sanitizeErrorCode(formatted?.reason, 'DESTINATION_FORMAT_FAILED') });
  }

  const result = await deps.sendTelegram({
    botToken,
    chatId: destination.destination_ref,
    text: formatted.text,
    parseMode: formatted.parseMode,
    fetchFn: deps.fetchFn,
    timeoutMs: destination?.settings?.timeoutMs,
  });
  if (!result?.ok) {
    return publicOutcome(destination, 'FAILED', {
      errorCode: sanitizeErrorCode(result?.errorCode, 'TELEGRAM_DELIVERY_FAILED'),
      statusCode: Number(result?.status) || 0,
    });
  }
  return publicOutcome(destination, 'SUCCEEDED', {
    statusCode: Number(result.status) || 200,
    ...(result.messageId != null ? { deliveryRef: String(result.messageId) } : {}),
  });
}

async function deliverOne(input, deps) {
  const { workspaceId, destination, env } = input;
  if (!destinationId(destination)) return publicOutcome(destination, 'REJECTED', { errorCode: 'DESTINATION_ID_REQUIRED' });
  if (destinationWorkspace(destination) !== text(workspaceId)) {
    return publicOutcome(destination, 'REJECTED', { errorCode: 'DESTINATION_WORKSPACE_MISMATCH' });
  }
  if (!active(destination)) return publicOutcome(destination, 'REJECTED', { errorCode: 'DESTINATION_DISABLED' });

  const type = destinationType(destination);
  if (type === 'telegram') return deliverTelegram(input, deps);
  if (type === 'audit_only') return publicOutcome(destination, 'SUCCEEDED', { deliveryRef: 'audit-only' });
  if (type === 'broker_account') {
    return publicOutcome(destination, 'BLOCKED', {
      errorCode: String(env.BROKER_EXECUTION_ENABLED ?? '').toLowerCase() === 'true'
        ? 'BROKER_DESTINATION_EXECUTION_NOT_WIRED'
        : 'BROKER_EXECUTION_DISABLED',
    });
  }
  if (type === 'internal_webhook') return publicOutcome(destination, 'BLOCKED', { errorCode: 'INTERNAL_WEBHOOK_NOT_WIRED' });
  return publicOutcome(destination, 'REJECTED', { errorCode: 'DESTINATION_TYPE_UNSUPPORTED' });
}

export async function runV1DestinationDeliveryStage({
  workspaceId,
  sourceId,
  event,
  interpretation,
  env = {},
} = {}, {
  destinationStore,
  decryptCredentials = decryptSecret,
  sendTelegram = sendTelegramDestination,
  formatTelegram = formatTelegramDestinationMessage,
  fetchFn = globalThis.fetch,
} = {}) {
  const trustedWorkspaceId = text(workspaceId);
  const trustedSourceId = text(sourceId);
  if (!trustedWorkspaceId || !trustedSourceId) {
    return { status: 'BLOCKED', succeeded: 0, failed: 0, rejected: 0, blocked: 0, outcomes: [], errorCode: 'DESTINATION_AUTHORITY_MISSING' };
  }
  if (!destinationStore?.listRoutedDestinations) {
    return { status: 'BLOCKED', succeeded: 0, failed: 0, rejected: 0, blocked: 0, outcomes: [], errorCode: 'DESTINATION_STORE_UNAVAILABLE' };
  }

  let destinations;
  try {
    destinations = await destinationStore.listRoutedDestinations(trustedWorkspaceId, trustedSourceId);
  } catch {
    return { status: 'BLOCKED', succeeded: 0, failed: 0, rejected: 0, blocked: 0, outcomes: [], errorCode: 'DESTINATION_ROUTE_LIST_FAILED' };
  }
  if (!Array.isArray(destinations) || destinations.length === 0) return stageSummary([]);

  const outcomes = [];
  for (const destination of destinations) {
    let outcome;
    try {
      outcome = await deliverOne({
        workspaceId: trustedWorkspaceId,
        destination,
        event,
        interpretation,
        env,
      }, { decryptCredentials, sendTelegram, formatTelegram, fetchFn });
    } catch {
      outcome = publicOutcome(destination, 'FAILED', { errorCode: 'DESTINATION_DELIVERY_FAILED' });
    }
    outcomes.push(outcome);
    await safeRecord(destinationStore, trustedWorkspaceId, destination, outcome);
  }
  return stageSummary(outcomes);
}
