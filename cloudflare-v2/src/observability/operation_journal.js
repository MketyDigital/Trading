const STAGES = new Set([
  'INGRESS',
  'AUTHORIZATION',
  'NORMALIZATION',
  'INTERPRETATION',
  'AI_PROVIDER',
  'SOURCE_RESOLUTION',
  'ROUTING',
  'DESTINATION',
  'TELEGRAM',
  'BROKER_PLANNING',
  'BROKER_EXECUTION',
  'MANAGEMENT',
  'REPLAY',
  'RECONCILIATION',
  'CONNECTOR',
  'PERSISTENCE',
]);

const STATUSES = new Set([
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'BLOCKED',
  'NEEDS_REVIEW',
  'REPAIR_REQUIRED',
]);

const SENSITIVE_KEY = /(?:authorization|password|passphrase|secret|token|credential|ciphertext|api[_-]?key|apikey|access[_-]?key)/i;

function clean(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function sanitizeDiagnostic(value, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeDiagnostic(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return value.slice(0, 1000);
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = sanitizeDiagnostic(item, depth + 1);
  }
  return output;
}

function normalizedRow(input = {}, nowFn = () => new Date()) {
  const workspaceId = clean(input.workspaceId ?? input.workspace_id);
  const correlationId = clean(input.correlationId ?? input.correlation_id);
  const stage = clean(input.stage)?.toUpperCase();
  const operation = clean(input.operation)?.toUpperCase();
  const status = clean(input.status)?.toUpperCase();

  if (!workspaceId) return { ok: false, reason: 'OPERATION_JOURNAL_WORKSPACE_REQUIRED' };
  if (!correlationId) return { ok: false, reason: 'OPERATION_JOURNAL_CORRELATION_REQUIRED' };
  if (!stage || !STAGES.has(stage)) return { ok: false, reason: 'OPERATION_JOURNAL_STAGE_INVALID' };
  if (!operation) return { ok: false, reason: 'OPERATION_JOURNAL_OPERATION_REQUIRED' };
  if (!status || !STATUSES.has(status)) return { ok: false, reason: 'OPERATION_JOURNAL_STATUS_INVALID' };

  const occurredAt = input.occurredAt ?? input.occurred_at ?? nowFn();
  const occurredDate = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (!Number.isFinite(occurredDate.getTime())) return { ok: false, reason: 'OPERATION_JOURNAL_OCCURRED_AT_INVALID' };

  const row = {
    workspace_id: workspaceId,
    correlation_id: correlationId,
    stage,
    operation,
    status,
    occurred_at: occurredDate.toISOString(),
    diagnostic: sanitizeDiagnostic(input.diagnostic && typeof input.diagnostic === 'object' ? input.diagnostic : {}),
  };

  const refs = [
    ['trading_event_id', input.tradingEventId ?? input.trading_event_id],
    ['source_connection_id', input.sourceConnectionId ?? input.source_connection_id],
    ['source_feed_id', input.sourceFeedId ?? input.source_feed_id],
    ['route_id', input.routeId ?? input.route_id],
    ['destination_id', input.destinationId ?? input.destination_id],
    ['destination_delivery_id', input.destinationDeliveryId ?? input.destination_delivery_id],
    ['trade_account_id', input.tradeAccountId ?? input.trade_account_id],
    ['position_group_id', input.positionGroupId ?? input.position_group_id],
    ['runtime_group_id', input.runtimeGroupId ?? input.runtime_group_id],
    ['ai_provider_id', input.aiProviderId ?? input.ai_provider_id],
    ['error_code', input.errorCode ?? input.error_code],
    ['customer_message', input.customerMessage ?? input.customer_message],
  ];
  for (const [key, value] of refs) {
    const normalized = clean(value);
    if (normalized) row[key] = normalized;
  }
  if (input.retryable !== undefined && input.retryable !== null) row.retryable = Boolean(input.retryable);

  return { ok: true, row };
}

export function createOperationJournal(supabase, { nowFn = () => new Date() } = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  return {
    async record(input = {}) {
      const normalized = normalizedRow(input, nowFn);
      if (!normalized.ok) return normalized;
      try {
        const { error } = await supabase.from('trading_operation_journal').insert(normalized.row);
        if (error) return { ok: false, reason: 'OPERATION_JOURNAL_PERSIST_FAILED' };
        return { ok: true };
      } catch {
        return { ok: false, reason: 'OPERATION_JOURNAL_PERSIST_FAILED' };
      }
    },
  };
}

export const operationJournalTaxonomy = {
  stages: Object.freeze([...STAGES]),
  statuses: Object.freeze([...STATUSES]),
};

export const operationJournalSanitizer = { sanitizeDiagnostic };
