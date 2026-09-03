const DELIVERY_STATUSES = Object.freeze(['PENDING', 'SUCCEEDED', 'RETRYABLE', 'UNCERTAIN', 'FAILED']);
const FAILURE_STATUSES = Object.freeze(['RETRYABLE', 'UNCERTAIN', 'FAILED']);

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
      const recentFailures = exactWorkspaceRows(recentResult.data, boundWorkspaceId).map(safeRecentFailure);

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
