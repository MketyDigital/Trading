const DELIVERY_STATUSES = Object.freeze(['PENDING', 'SUCCEEDED', 'RETRYABLE', 'UNCERTAIN', 'FAILED']);
const FAILURE_STATUSES = Object.freeze(['RETRYABLE', 'UNCERTAIN', 'FAILED']);
const SECRET_KEY_PATTERN = /(secret|token|password|credential|authorization|api[_-]?key|private[_-]?key|cipher)/i;

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

function sanitizePersistedValue(value) {
  if (Array.isArray(value)) return value.map(sanitizePersistedValue);
  if (!value || typeof value !== 'object') return value;

  const safe = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    safe[key] = sanitizePersistedValue(nested);
  }
  return safe;
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
      const blocked = exactWorkspaceRows(accountsResult.data, boundWorkspaceId)
        .map(accountSafetyBlock)
        .filter(Boolean);

      return {
        workspaceId: boundWorkspaceId,
        observedAt,
        deliveries: {
          counts: Object.fromEntries(countEntries),
          overdueRetryable: Number(overdue.count || 0),
          recentFailures,
        },
        accountSafety: {
          blocked,
          blockedCount: blocked.length,
        },
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

      return {
        workspaceId: boundWorkspaceId,
        event: safeAuditEvent(eventRow),
        source: sourceRow ? safeAuditSource(sourceRow) : null,
        positionGroups: groupRows.map((row) => safeAuditGroup(row, legsByGroup.get(text(row.id)) || [])),
        deliveries: deliveryRows.map(safeAuditDelivery),
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
