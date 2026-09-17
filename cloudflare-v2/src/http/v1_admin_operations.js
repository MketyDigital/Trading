const DELIVERY_STATUSES = Object.freeze(['PENDING', 'SUCCEEDED', 'RETRYABLE', 'UNCERTAIN', 'FAILED']);
const FAILURE_STATUSES = Object.freeze(['RETRYABLE', 'UNCERTAIN', 'FAILED']);
const SECRET_KEY_PATTERN = /(secret|token|password|credential|authorization|api[_-]?key|private[_-]?key|cipher)/i;
const DROP_PERSISTED_KEYS = new Set([
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
const RESILIENCE_SCOPE_MISMATCH = 'OPERATIONS_RESILIENCE_WORKSPACE_SCOPE_MISMATCH';

function text(value) {
  return String(value ?? '').trim();
}

function safeLimit(value) {
  return Math.max(1, Math.min(50, Math.trunc(Number(value) || 10)));
}

function validObservedAt(nowFn) {
  const value = nowFn();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('operations clock is invalid');
  return date.toISOString();
}

function assertQuery(result, label) {
  if (result?.error) throw new Error(`${label} query failed`);
  return result || {};
}

function exactWorkspaceRows(rows, workspaceId) {
  const safeRows = Array.isArray(rows) ? rows : [];
  for (const row of safeRows) {
    if (text(row?.workspace_id) !== workspaceId) {
      throw new Error('operations workspace scope mismatch');
    }
  }
  return safeRows;
}

function exactWorkspaceRow(row, workspaceId) {
  if (!row) return null;
  if (text(row.workspace_id) !== workspaceId) {
    throw new Error('operations workspace scope mismatch');
  }
  return row;
}

function normalizedPersistedKey(key) {
  return String(key ?? '').trim().replace(/[\s-]+/g, '_').toLowerCase();
}

function sanitizePersistedValue(value) {
  if (Array.isArray(value)) return value.map(sanitizePersistedValue);
  if (!value || typeof value !== 'object') return value;

  const safe = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = normalizedPersistedKey(key);
    if (SECRET_KEY_PATTERN.test(key) || DROP_PERSISTED_KEYS.has(normalizedKey)) continue;
    safe[key] = sanitizePersistedValue(nested);
  }
  return safe;
}

function boundedNumber(value, { min = 0, max = Number.POSITIVE_INFINITY, integer = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const bounded = Math.min(max, Math.max(min, numeric));
  return integer ? Math.trunc(bounded) : bounded;
}

function safePercentiles(value = {}) {
  return {
    p50: boundedNumber(value?.p50),
    p95: boundedNumber(value?.p95),
    p99: boundedNumber(value?.p99),
  };
}

function safeResilienceSummary(raw, workspaceId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { available: false };
  }
  if (text(raw.workspaceId) !== workspaceId) {
    const error = new Error('operations resilience workspace scope mismatch');
    error.code = RESILIENCE_SCOPE_MISMATCH;
    throw error;
  }

  return {
    available: true,
    fallbackCounts: {
      ambiguityAiReview: boundedNumber(raw.fallbackCounts?.ambiguityAiReview, { integer: true }),
      destinationAiFallback: boundedNumber(raw.fallbackCounts?.destinationAiFallback, { integer: true }),
    },
    retryRate: boundedNumber(raw.retryRate, { max: 1 }),
    uncertainRate: boundedNumber(raw.uncertainRate, { max: 1 }),
    latencyMs: {
      sourceToBrokerSend: safePercentiles(raw.latencyMs?.sourceToBrokerSend),
      brokerRoundTrip: safePercentiles(raw.latencyMs?.brokerRoundTrip),
      sourceToDestinationAck: safePercentiles(raw.latencyMs?.sourceToDestinationAck),
    },
  };
}

async function loadResilienceSummary(resilienceMetricsSource, workspaceId) {
  if (typeof resilienceMetricsSource?.snapshot !== 'function') return { available: false };
  try {
    return safeResilienceSummary(await resilienceMetricsSource.snapshot(workspaceId), workspaceId);
  } catch (error) {
    if (error?.code === RESILIENCE_SCOPE_MISMATCH) throw error;
    return { available: false };
  }
}

function safeRecentFailure(row = {}) {
  return {
    deliveryId: row.id ?? null,
    tradingEventId: row.trading_event_id ?? null,
    destinationType: row.destination_type ?? null,
    destinationRef: row.destination_ref ?? null,
    status: row.status ?? null,
    errorCode: row.error_code ?? null,
    failureClass: row.failure_class ?? null,
    attemptCount: Number.isFinite(Number(row.attempt_count)) ? Number(row.attempt_count) : 0,
    nextAttemptAt: row.next_attempt_at ?? null,
    lastAttemptAt: row.last_attempt_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function safeOperationTimelineRow(row = {}) {
  return {
    tradingEventId: row.trading_event_id ?? null,
    correlationId: row.correlation_id ?? null,
    stage: row.stage ?? null,
    operation: row.operation ?? null,
    status: row.status ?? null,
    errorCode: row.error_code ?? null,
    failureClass: row.failure_class ?? null,
    retryable: row.retryable == null ? null : Boolean(row.retryable),
    summary: row.summary ?? null,
    details: sanitizePersistedValue(row.details && typeof row.details === 'object' ? row.details : {}),
    observedAt: row.observed_at ?? null,
  };
}

function canonicalSymbol(intent = {}) {
  if (typeof intent?.symbol === 'string') return intent.symbol || null;
  return intent?.symbol?.canonical ?? null;
}

function safeRecentEvent(row = {}, { source = null, groups = [], accountsById = new Map(), deliveries = [] } = {}) {
  const canonicalIntent = row.canonical_intent == null ? null : sanitizePersistedValue(row.canonical_intent);
  const intent = canonicalIntent?.intent && typeof canonicalIntent.intent === 'object' ? canonicalIntent.intent : null;
  const management = canonicalIntent?.management && typeof canonicalIntent.management === 'object' ? canonicalIntent.management : null;
  const matchedExisting = groups.some((group) => {
    const primary = text(group?.source_event_id);
    const linked = Array.isArray(group?.source_event_ids) ? group.source_event_ids.map(String) : [];
    return primary !== text(row.id) && linked.includes(String(row.id));
  });
  const group = groups[0] || null;
  const destinations = groups.map((item) => {
    const account = accountsById.get(text(item.trade_account_id));
    return {
      positionGroupId: item.id ?? null,
      tradeAccountId: item.trade_account_id ?? null,
      accountLabel: account?.account_label ?? null,
      platform: account?.platform ?? null,
      groupStatus: item.status ?? null,
    };
  });
  const safeDeliveries = deliveries.map((delivery) => ({
    deliveryId: delivery.id ?? null,
    destinationType: delivery.destination_type ?? null,
    destinationRef: delivery.destination_ref ?? null,
    status: delivery.status ?? null,
    errorCode: delivery.error_code ?? null,
    failureClass: delivery.failure_class ?? null,
    reconciliationStatus: delivery.failure_class === 'STATE_BINDING_PENDING'
      ? 'STATE_BINDING_PENDING'
      : delivery.status === 'SUCCEEDED'
        ? 'BROKER_SUCCEEDED'
        : null,
    updatedAt: delivery.updated_at ?? null,
  }));

  return {
    eventId: row.id ?? null,
    drilldownEventId: row.id ?? null,
    externalEventId: row.external_event_id ?? null,
    receivedAt: row.received_at ?? null,
    processingStatus: row.processing_status ?? null,
    parserSource: canonicalIntent?.source ?? null,
    source: source ? {
      sourceConnectionId: source.id ?? null,
      sourceType: source.source_type ?? row.source_type ?? null,
      providerType: source.provider_type ?? null,
      sourceInstanceId: source.source_instance_id ?? null,
      displayName: source.display_name ?? null,
      sourceExternalId: row.source_external_id ?? null,
    } : {
      sourceConnectionId: row.source_connection_id ?? null,
      sourceType: row.source_type ?? null,
      providerType: null,
      sourceInstanceId: null,
      displayName: null,
      sourceExternalId: row.source_external_id ?? null,
    },
    eventType: canonicalIntent?.status ?? null,
    canonicalSymbol: canonicalSymbol(intent) ?? group?.canonical_symbol ?? null,
    side: intent?.side ?? group?.side ?? null,
    orderType: intent?.orderType ?? intent?.order_type ?? group?.order_type ?? null,
    managementType: management?.type ?? null,
    numericInterpretation: intent ? {
      entry: intent.entry ?? null,
      stopLoss: intent.stopLoss ?? intent.stop_loss ?? null,
      takeProfits: Array.isArray(intent.takeProfits) ? intent.takeProfits : Array.isArray(intent.take_profits) ? intent.take_profits : [],
      normalization: canonicalIntent?.normalization ?? null,
    } : null,
    correlation: group ? {
      kind: matchedExisting ? 'MATCHED_EXISTING_GROUP' : 'PRIMARY_GROUP_EVENT',
      positionGroupId: group.id ?? null,
      correlationKey: group.correlation_key ?? null,
    } : null,
    destinations,
    deliveries: safeDeliveries,
    errorCode: row.error_code ?? null,
  };
}

function accountSafetyBlock(account = {}) {
  const reasons = [];
  if (account.is_active !== true) reasons.push('ACCOUNT_INACTIVE');
  if (account.execution_enabled !== true) reasons.push('ACCOUNT_EXECUTION_DISABLED');

  const policy = account.safety_policy && typeof account.safety_policy === 'object' && !Array.isArray(account.safety_policy)
    ? account.safety_policy
    : {};
  if (policy.enabled === false) reasons.push('ACCOUNT_POLICY_DISABLED');
  if (policy.killSwitch === true) reasons.push('KILL_SWITCH');
  if (reasons.length === 0) return null;

  return {
    tradeAccountId: account.id ?? null,
    label: account.account_label ?? null,
    platform: account.platform ?? null,
    reasons,
  };
}

function safeAuditEvent(row = {}) {
  return {
    eventId: row.id ?? null,
    sourceConnectionId: row.source_connection_id ?? null,
    externalEventId: row.external_event_id ?? null,
    eventVersion: row.event_version ?? null,
    sourceType: row.source_type ?? null,
    sourceExternalId: row.source_external_id ?? null,
    occurredAt: row.occurred_at ?? null,
    receivedAt: row.received_at ?? null,
    processingStatus: row.processing_status ?? null,
    canonicalIntent: row.canonical_intent == null ? null : sanitizePersistedValue(row.canonical_intent),
    errorCode: row.error_code ?? null,
    createdAt: row.created_at ?? null,
  };
}

function safeAuditSource(row = {}) {
  return {
    sourceConnectionId: row.id ?? null,
    sourceType: row.source_type ?? null,
    sourceFamily: row.source_family ?? null,
    providerType: row.provider_type ?? null,
    sourceInstanceId: row.source_instance_id ?? null,
    displayName: row.display_name ?? null,
    externalIdentity: row.external_identity ?? null,
  };
}

function safeAuditLeg(row = {}) {
  return {
    positionLegId: row.id ?? null,
    positionGroupId: row.position_group_id ?? null,
    targetIndex: Number.isFinite(Number(row.target_index)) ? Number(row.target_index) : null,
    lots: row.lots ?? null,
    stopLoss: row.stop_loss ?? null,
    takeProfit: row.take_profit ?? null,
    status: row.status ?? null,
    brokerPositionId: row.broker_position_id ?? null,
    brokerOrderId: row.broker_order_id ?? null,
    openedAt: row.opened_at ?? null,
    closedAt: row.closed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function safeAuditGroup(row = {}, legs = []) {
  return {
    positionGroupId: row.id ?? null,
    tradeAccountId: row.trade_account_id ?? null,
    sourceEventId: row.source_event_id ?? null,
    sourceEventIds: Array.isArray(row.source_event_ids) ? row.source_event_ids : [],
    sourceInstanceId: row.source_instance_id ?? null,
    correlationKey: row.correlation_key ?? null,
    canonicalSymbol: row.canonical_symbol ?? null,
    side: row.side ?? null,
    orderType: row.order_type ?? null,
    stopLoss: row.stop_loss ?? null,
    status: row.status ?? null,
    incomplete: Boolean(row.incomplete),
    positionMode: row.position_mode ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    legs,
  };
}

function safeAuditDelivery(row = {}) {
  return {
    deliveryId: row.id ?? null,
    tradingEventId: row.trading_event_id ?? null,
    destinationType: row.destination_type ?? null,
    destinationRef: row.destination_ref ?? null,
    status: row.status ?? null,
    errorCode: row.error_code ?? null,
    failureClass: row.failure_class ?? null,
    attemptCount: Number.isFinite(Number(row.attempt_count)) ? Number(row.attempt_count) : 0,
    nextAttemptAt: row.next_attempt_at ?? null,
    lastAttemptAt: row.last_attempt_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function createAdminOperationsStore(supabase, {
  nowFn = () => new Date(),
  recentLimit = 10,
  resilienceMetricsSource = null,
} = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  if (typeof nowFn !== 'function') throw new TypeError('nowFn is required');
  const boundedRecentLimit = safeLimit(recentLimit);

  return {
    async snapshot(workspaceId) {
      const boundWorkspaceId = text(workspaceId);
      if (!boundWorkspaceId) throw new TypeError('workspaceId is required');
      const observedAt = validObservedAt(nowFn);

      const countEntries = await Promise.all(DELIVERY_STATUSES.map(async (status) => {
        const result = assertQuery(await supabase
          .from('destination_deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', boundWorkspaceId)
          .eq('status', status), `delivery ${status}`);
        return [status, Number(result.count || 0)];
      }));

      const overdue = assertQuery(await supabase
        .from('destination_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', boundWorkspaceId)
        .eq('status', 'RETRYABLE')
        .lte('next_attempt_at', observedAt), 'overdue retry');

      const recentResult = assertQuery(await supabase
        .from('destination_deliveries')
        .select('id,workspace_id,trading_event_id,destination_type,destination_ref,status,error_code,failure_class,attempt_count,next_attempt_at,last_attempt_at,updated_at')
        .eq('workspace_id', boundWorkspaceId)
        .in('status', FAILURE_STATUSES)
        .order('updated_at', { ascending: false })
        .limit(boundedRecentLimit), 'recent delivery failures');
      const recentFailures = exactWorkspaceRows(recentResult.data, boundWorkspaceId)
        .filter((row) => Boolean(text(row?.error_code) || text(row?.failure_class)))
        .map(safeRecentFailure);

      const accountsResult = assertQuery(await supabase
        .from('trade_accounts')
        .select('id,workspace_id,account_label,platform,is_active,execution_enabled,safety_policy')
        .eq('workspace_id', boundWorkspaceId)
        .order('id', { ascending: true }), 'account safety');
      const accountRows = exactWorkspaceRows(accountsResult.data, boundWorkspaceId);
      const blocked = accountRows
        .map(accountSafetyBlock)
        .filter(Boolean);

      const recentEventsResult = assertQuery(await supabase
        .from('trading_events')
        .select('id,workspace_id,source_connection_id,external_event_id,source_type,source_external_id,received_at,processing_status,canonical_intent,error_code,created_at')
        .eq('workspace_id', boundWorkspaceId)
        .order('received_at', { ascending: false })
        .limit(boundedRecentLimit), 'recent trading events');
      const eventRows = exactWorkspaceRows(recentEventsResult.data, boundWorkspaceId);
      const eventIds = eventRows.map((row) => text(row.id)).filter(Boolean);
      const sourceIds = [...new Set(eventRows.map((row) => text(row.source_connection_id)).filter(Boolean))];

      let sourceRows = [];
      if (sourceIds.length > 0) {
        const sourceResult = assertQuery(await supabase
          .from('source_connections')
          .select('id,workspace_id,source_type,provider_type,source_instance_id,display_name')
          .eq('workspace_id', boundWorkspaceId)
          .in('id', sourceIds), 'recent event sources');
        sourceRows = exactWorkspaceRows(sourceResult.data, boundWorkspaceId);
      }
      const sourcesById = new Map(sourceRows.map((row) => [text(row.id), row]));

      const groupRows = [];
      const seenGroupIds = new Set();
      if (eventIds.length > 0) {
        const groupColumns = 'id,workspace_id,trade_account_id,source_event_id,source_event_ids,correlation_key,canonical_symbol,side,order_type,status,updated_at';
        const directGroupsResult = assertQuery(await supabase
          .from('position_groups')
          .select(groupColumns)
          .eq('workspace_id', boundWorkspaceId)
          .in('source_event_id', eventIds), 'recent direct position groups');
        for (const row of exactWorkspaceRows(directGroupsResult.data, boundWorkspaceId)) {
          const id = text(row?.id);
          if (!id || seenGroupIds.has(id)) continue;
          seenGroupIds.add(id);
          groupRows.push(row);
        }
        for (const eventId of eventIds) {
          const linkedGroupsResult = assertQuery(await supabase
            .from('position_groups')
            .select(groupColumns)
            .eq('workspace_id', boundWorkspaceId)
            .contains('source_event_ids', [eventId]), 'recent linked position groups');
          for (const row of exactWorkspaceRows(linkedGroupsResult.data, boundWorkspaceId)) {
            const id = text(row?.id);
            if (!id || seenGroupIds.has(id)) continue;
            seenGroupIds.add(id);
            groupRows.push(row);
          }
        }
      }

      const accountIds = [...new Set(groupRows.map((row) => text(row.trade_account_id)).filter(Boolean))];
      let recentAccountRows = [];
      if (accountIds.length > 0) {
        const recentAccountsResult = assertQuery(await supabase
          .from('trade_accounts')
          .select('id,workspace_id,account_label,platform')
          .eq('workspace_id', boundWorkspaceId)
          .in('id', accountIds), 'recent event accounts');
        recentAccountRows = exactWorkspaceRows(recentAccountsResult.data, boundWorkspaceId);
      }
      const accountsById = new Map(recentAccountRows.map((row) => [text(row.id), row]));

      let recentDeliveryRows = [];
      if (eventIds.length > 0) {
        const deliveriesResult = assertQuery(await supabase
          .from('destination_deliveries')
          .select('id,workspace_id,trading_event_id,destination_type,destination_ref,status,error_code,failure_class,updated_at')
          .eq('workspace_id', boundWorkspaceId)
          .in('trading_event_id', eventIds)
          .order('updated_at', { ascending: false }), 'recent event deliveries');
        recentDeliveryRows = exactWorkspaceRows(deliveriesResult.data, boundWorkspaceId);
      }

      const recentEvents = eventRows.map((row) => {
        const eventId = text(row.id);
        const groups = groupRows.filter((group) => text(group.source_event_id) === eventId
          || (Array.isArray(group.source_event_ids) && group.source_event_ids.map(String).includes(eventId)));
        const deliveries = recentDeliveryRows.filter((delivery) => text(delivery.trading_event_id) === eventId);
        return safeRecentEvent(row, {
          source: sourcesById.get(text(row.source_connection_id)) || null,
          groups,
          accountsById,
          deliveries,
        });
      });

      const operationJournalResult = assertQuery(await supabase
        .from('operation_journal')
        .select('workspace_id,correlation_id,trading_event_id,stage,operation,status,error_code,failure_class,retryable,summary,details,observed_at')
        .eq('workspace_id', boundWorkspaceId)
        .order('observed_at', { ascending: false })
        .limit(boundedRecentLimit), 'operation journal');
      const operationTimeline = exactWorkspaceRows(operationJournalResult.data, boundWorkspaceId)
        .map(safeOperationTimelineRow);

      const resilience = await loadResilienceSummary(resilienceMetricsSource, boundWorkspaceId);

      return {
        workspaceId: boundWorkspaceId,
        observedAt,
        recentEvents,
        operationTimeline,
        deliveries: {
          counts: Object.fromEntries(countEntries),
          overdueRetryable: Number(overdue.count || 0),
          recentFailures,
        },
        accountSafety: {
          blocked,
          blockedCount: blocked.length,
        },
        resilience,
      };
    },

    async auditEvent(workspaceId, eventId) {
      const boundWorkspaceId = text(workspaceId);
      const boundEventId = text(eventId);
      if (!boundWorkspaceId) throw new TypeError('workspaceId is required');
      if (!boundEventId) throw new TypeError('eventId is required');

      const eventResult = assertQuery(await supabase
        .from('trading_events')
        .select('id,workspace_id,source_connection_id,external_event_id,event_version,source_type,source_external_id,occurred_at,received_at,processing_status,canonical_intent,error_code,created_at')
        .eq('workspace_id', boundWorkspaceId)
        .eq('id', boundEventId)
        .maybeSingle(), 'event audit');
      const eventRow = exactWorkspaceRow(eventResult.data, boundWorkspaceId);
      if (!eventRow) return null;

      const sourceResult = assertQuery(await supabase
        .from('source_connections')
        .select('id,workspace_id,source_type,source_family,provider_type,source_instance_id,display_name,external_identity')
        .eq('workspace_id', boundWorkspaceId)
        .eq('id', String(eventRow.source_connection_id))
        .maybeSingle(), 'event source audit');
      const sourceRow = exactWorkspaceRow(sourceResult.data, boundWorkspaceId);

      const groupColumns = 'id,workspace_id,trade_account_id,source_event_id,source_event_ids,source_instance_id,correlation_key,canonical_symbol,side,order_type,stop_loss,status,incomplete,position_mode,created_at,updated_at';
      const directGroupsResult = assertQuery(await supabase
        .from('position_groups')
        .select(groupColumns)
        .eq('workspace_id', boundWorkspaceId)
        .eq('source_event_id', boundEventId), 'direct position group audit');
      const linkedGroupsResult = assertQuery(await supabase
        .from('position_groups')
        .select(groupColumns)
        .eq('workspace_id', boundWorkspaceId)
        .contains('source_event_ids', [boundEventId]), 'linked position group audit');

      const groupRows = [];
      const seenGroupIds = new Set();
      for (const row of [
        ...exactWorkspaceRows(directGroupsResult.data, boundWorkspaceId),
        ...exactWorkspaceRows(linkedGroupsResult.data, boundWorkspaceId),
      ]) {
        const id = text(row?.id);
        if (!id || seenGroupIds.has(id)) continue;
        seenGroupIds.add(id);
        groupRows.push(row);
      }

      let legRows = [];
      if (groupRows.length > 0) {
        const legsResult = assertQuery(await supabase
          .from('position_legs')
          .select('id,workspace_id,position_group_id,target_index,lots,stop_loss,take_profit,status,broker_position_id,broker_order_id,opened_at,closed_at,created_at,updated_at')
          .eq('workspace_id', boundWorkspaceId)
          .in('position_group_id', groupRows.map((row) => row.id))
          .order('target_index', { ascending: true }), 'position leg audit');
        legRows = exactWorkspaceRows(legsResult.data, boundWorkspaceId);
      }

      const legsByGroup = new Map();
      for (const row of legRows) {
        const groupId = text(row.position_group_id);
        const bucket = legsByGroup.get(groupId) || [];
        bucket.push(safeAuditLeg(row));
        legsByGroup.set(groupId, bucket);
      }

      const deliveriesResult = assertQuery(await supabase
        .from('destination_deliveries')
        .select('id,workspace_id,trading_event_id,destination_type,destination_ref,status,error_code,failure_class,attempt_count,next_attempt_at,last_attempt_at,created_at,updated_at')
        .eq('workspace_id', boundWorkspaceId)
        .eq('trading_event_id', boundEventId)
        .order('created_at', { ascending: true }), 'destination delivery audit');
      const deliveryRows = exactWorkspaceRows(deliveriesResult.data, boundWorkspaceId);

      const operationJournalResult = assertQuery(await supabase
        .from('operation_journal')
        .select('workspace_id,correlation_id,trading_event_id,stage,operation,status,error_code,failure_class,retryable,summary,details,observed_at')
        .eq('workspace_id', boundWorkspaceId)
        .eq('trading_event_id', boundEventId)
        .order('observed_at', { ascending: true }), 'event operation journal');
      const operationTimeline = exactWorkspaceRows(operationJournalResult.data, boundWorkspaceId)
        .map(safeOperationTimelineRow);

      return {
        workspaceId: boundWorkspaceId,
        event: safeAuditEvent(eventRow),
        source: sourceRow ? safeAuditSource(sourceRow) : null,
        positionGroups: groupRows.map((row) => safeAuditGroup(row, legsByGroup.get(text(row.id)) || [])),
        deliveries: deliveryRows.map(safeAuditDelivery),
        operationTimeline,
        historyCoverage: {
          actorHistoryRecorded: false,
        },
      };
    },
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export async function handleAuthorizedV1AdminOperationsRequest(request, authorization, { operationsStore } = {}) {
  if (request.method !== 'GET') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
  }
  if (!authorization?.membership || authorization.membership.role == null) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }

  const { hasTradingPermission } = await import('../security/trading_permissions.js');
  if (!hasTradingPermission(authorization.membership.role, 'operations.read')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }
  if (!operationsStore?.snapshot) {
    return json({ ok: false, reason: 'OPERATIONS_STORE_UNAVAILABLE' }, 503);
  }

  try {
    const operations = await operationsStore.snapshot(String(authorization.workspace.id));
    return json({ ok: true, operations });
  } catch {
    return json({ ok: false, reason: 'OPERATIONS_QUERY_FAILED' }, 503);
  }
}

export async function handleAuthorizedV1AdminEventAuditRequest(request, authorization, { eventId, operationsStore } = {}) {
  if (!authorization?.membership || authorization.membership.role == null) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }

  const { hasTradingPermission } = await import('../security/trading_permissions.js');
  if (!hasTradingPermission(authorization.membership.role, 'operations.read')) {
    return json({ ok: false, reason: 'TRADING_PERMISSION_DENIED' }, 403);
  }
  if (request.method !== 'GET') {
    return json({ ok: false, reason: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
  }
  if (!operationsStore?.auditEvent) {
    return json({ ok: false, reason: 'OPERATIONS_STORE_UNAVAILABLE' }, 503);
  }

  try {
    const audit = await operationsStore.auditEvent(String(authorization.workspace.id), eventId);
    if (!audit) return json({ ok: false, reason: 'TRADING_EVENT_NOT_FOUND' }, 404);
    return json({ ok: true, audit });
  } catch {
    return json({ ok: false, reason: 'EVENT_AUDIT_QUERY_FAILED' }, 503);
  }
}
