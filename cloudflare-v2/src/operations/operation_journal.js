const OPERATION_STAGES = new Set([
  'INGRESS',
  'AUTHORIZATION',
  'INTERPRETATION',
  'AI_PROVIDER',
  'CORRELATION',
  'ROUTE',
  'DESTINATION',
  'BROKER_PLANNING',
  'BROKER_EXECUTION',
  'MANAGEMENT',
  'REPLAY',
  'RECONCILIATION',
  'CONNECTOR',
  'PERSISTENCE',
]);

const OPERATION_STATUSES = new Set([
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'BLOCKED',
  'RETRYABLE',
  'UNCERTAIN',
  'INFO',
]);

const DROP_DETAIL_KEYS = new Set([
  'stack',
  'stacktrace',
  'stack_trace',
  'raw_body',
  'rawbody',
  'request_body',
  'requestbody',
  'response_body',
  'responsebody',
  'raw_payload',
  'rawpayload',
  'request_payload',
  'requestpayload',
  'response_payload',
  'responsepayload',
]);

const SECRET_KEY_PATTERN = /(?:^|_)(?:api_?key|apikey|authorization|auth_?header|bearer|token|secret|password|passwd|credential|ciphertext|session|private_?key|access_?key|secret_?access_?key)(?:$|_)/i;

function text(value, max = 512) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function normalizeKeyName(key) {
  return String(key ?? '').trim().replace(/[\s-]+/g, '_').toLowerCase();
}

function sanitizeString(value, max = 2000) {
  let output = String(value ?? '');
  output = output
    .replace(/Bearer\s+[A-Za-z0-9._~+\-/=]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_ -]?key\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(secret(?:[_ -]?access)?[_ -]?key\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(password\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(token\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return output.slice(0, max);
}

function sanitizeDetailsValue(value, depth = 0) {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeDetailsValue(item, depth + 1));
  }
  if (typeof value !== 'object') return sanitizeString(value);

  const output = {};
  let count = 0;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (count >= 100) break;
    const normalizedKey = normalizeKeyName(rawKey);
    if (!normalizedKey || DROP_DETAIL_KEYS.has(normalizedKey)) continue;
    if (SECRET_KEY_PATTERN.test(normalizedKey)) {
      output[rawKey] = '[REDACTED]';
      count += 1;
      continue;
    }
    output[rawKey] = sanitizeDetailsValue(rawValue, depth + 1);
    count += 1;
  }
  return output;
}

function normalizeStage(value) {
  const stage = String(value ?? '').trim().toUpperCase();
  if (!OPERATION_STAGES.has(stage)) throw new Error('OPERATION_STAGE_INVALID');
  return stage;
}

function normalizeStatus(value) {
  const status = String(value ?? '').trim().toUpperCase();
  if (!OPERATION_STATUSES.has(status)) throw new Error('OPERATION_STATUS_INVALID');
  return status;
}

function requiredText(value, code, max = 512) {
  const normalized = text(value, max);
  if (!normalized) throw new Error(code);
  return normalized;
}

function optionalObservedAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('OPERATION_OBSERVED_AT_INVALID');
  return date.toISOString();
}

export function normalizeOperationEvidence(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('operation evidence must be an object');
  }

  const details = input.details && typeof input.details === 'object' && !Array.isArray(input.details)
    ? sanitizeDetailsValue(input.details)
    : {};

  return {
    workspaceId: requiredText(input.workspaceId ?? input.workspace_id, 'OPERATION_WORKSPACE_REQUIRED'),
    evidenceKey: requiredText(input.evidenceKey ?? input.evidence_key, 'OPERATION_EVIDENCE_KEY_REQUIRED', 1000),
    correlationId: requiredText(input.correlationId ?? input.correlation_id, 'OPERATION_CORRELATION_ID_REQUIRED', 1000),
    tradingEventId: text(input.tradingEventId ?? input.trading_event_id),
    sourceConnectionId: text(input.sourceConnectionId ?? input.source_connection_id),
    sourceFeedId: text(input.sourceFeedId ?? input.source_feed_id),
    routeId: text(input.routeId ?? input.route_id),
    destinationId: text(input.destinationId ?? input.destination_id),
    tradeAccountId: text(input.tradeAccountId ?? input.trade_account_id),
    aiProviderId: text(input.aiProviderId ?? input.ai_provider_id),
    positionGroupId: text(input.positionGroupId ?? input.position_group_id),
    connectorId: text(input.connectorId ?? input.connector_id),
    stage: normalizeStage(input.stage),
    operation: requiredText(input.operation, 'OPERATION_NAME_REQUIRED', 256),
    status: normalizeStatus(input.status),
    errorCode: text(input.errorCode ?? input.error_code, 256),
    failureClass: text(input.failureClass ?? input.failure_class, 256),
    retryable: input.retryable == null ? null : Boolean(input.retryable),
    summary: text(input.summary, 1000),
    details,
    observedAt: optionalObservedAt(input.observedAt ?? input.observed_at),
  };
}

function toDatabaseRow(evidence) {
  return {
    workspace_id: evidence.workspaceId,
    evidence_key: evidence.evidenceKey,
    correlation_id: evidence.correlationId,
    trading_event_id: evidence.tradingEventId,
    source_connection_id: evidence.sourceConnectionId,
    source_feed_id: evidence.sourceFeedId,
    route_id: evidence.routeId,
    destination_id: evidence.destinationId,
    trade_account_id: evidence.tradeAccountId,
    ai_provider_id: evidence.aiProviderId,
    position_group_id: evidence.positionGroupId,
    connector_id: evidence.connectorId,
    stage: evidence.stage,
    operation: evidence.operation,
    status: evidence.status,
    error_code: evidence.errorCode,
    failure_class: evidence.failureClass,
    retryable: evidence.retryable,
    summary: evidence.summary,
    details: evidence.details,
    observed_at: evidence.observedAt,
  };
}

export function createOperationJournalStore(supabase, { nowFn = () => new Date() } = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  if (typeof nowFn !== 'function') throw new TypeError('nowFn is required');

  return {
    async append(input) {
      const normalized = normalizeOperationEvidence({
        ...input,
        observedAt: input?.observedAt ?? input?.observed_at ?? nowFn(),
      });
      const { error } = await supabase
        .from('operation_journal')
        .upsert(toDatabaseRow(normalized), {
          onConflict: 'workspace_id,evidence_key',
          ignoreDuplicates: true,
        });
      if (error) throw new Error('OPERATION_JOURNAL_APPEND_FAILED');
      return normalized;
    },
  };
}

export const OPERATION_JOURNAL_STAGES = Object.freeze([...OPERATION_STAGES]);
export const OPERATION_JOURNAL_STATUSES = Object.freeze([...OPERATION_STATUSES]);
