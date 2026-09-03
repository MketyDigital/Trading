function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function nonEmpty(value) {
  return String(value ?? '').trim().length > 0;
}

function isValidClaimedDelivery(delivery) {
  const payload = delivery?.request_payload;
  const action = payload?.action;
  return Boolean(
    nonEmpty(delivery?.workspace_id) &&
    nonEmpty(delivery?.destination_type) &&
    nonEmpty(delivery?.idempotency_key) &&
    payload && typeof payload === 'object' &&
    nonEmpty(payload.accountId) &&
    nonEmpty(payload.groupId) &&
    action && typeof action === 'object' &&
    nonEmpty(action.idempotencyKey) &&
    String(action.idempotencyKey) === String(delivery.idempotency_key)
  );
}

function disabledSummary() {
  return {
    status: 'BROKER_EXECUTION_DISABLED',
    scanned: 0,
    claimed: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
  };
}

export function createDestinationRetryRuntime({
  supabaseFactory,
  listDueFn,
  claimFn,
  recoverFn,
  batchLimit = 10,
  leaseMs = 30000,
} = {}) {
  if (typeof supabaseFactory !== 'function') throw new TypeError('supabaseFactory is required');
  if (typeof listDueFn !== 'function') throw new TypeError('listDueFn is required');
  if (typeof claimFn !== 'function') throw new TypeError('claimFn is required');
  if (typeof recoverFn !== 'function') throw new TypeError('recoverFn is required');

  const safeBatchLimit = Math.max(1, Math.min(100, Math.trunc(Number(batchLimit) || 10)));
  const safeLeaseMs = Math.max(1000, Math.min(300000, Math.trunc(Number(leaseMs) || 30000)));

  return async function runDestinationRetry(env = {}, { nowMs = Date.now() } = {}) {
    // Structural master fuse: disabled recovery cannot construct Supabase or scan.
    if (!isEnabled(env?.BROKER_EXECUTION_ENABLED)) return disabledSummary();

    const timestamp = Number(nowMs);
    if (!Number.isFinite(timestamp)) throw new TypeError('nowMs must be finite');
    const now = new Date(timestamp).toISOString();
    const leaseUntil = new Date(timestamp + safeLeaseMs).toISOString();
    const supabase = await supabaseFactory(env);
    const listed = await listDueFn({ supabase, now, limit: safeBatchLimit });
    const due = Array.isArray(listed) ? listed.slice(0, safeBatchLimit) : [];

    let claimed = 0;
    let dispatched = 0;
    let succeeded = 0;
    let failed = 0;

    for (const delivery of due) {
      let claim;
      try {
        claim = await claimFn({ supabase, delivery, now, leaseUntil });
      } catch {
        failed += 1;
        continue;
      }
      if (!claim?.claimed) continue;
      claimed += 1;

      const claimedRow = claim.row || delivery;
      if (!isValidClaimedDelivery(claimedRow)) {
        failed += 1;
        continue;
      }

      dispatched += 1;
      try {
        const result = await recoverFn({ env, supabase, delivery: claimedRow, now });
        const status = String(result?.status ?? '').toUpperCase();
        if (status === 'SUCCEEDED' || status === 'DUPLICATE') succeeded += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      status: failed > 0 ? (succeeded > 0 ? 'PARTIAL_FAILURE' : 'FAILED') : 'COMPLETED',
      scanned: due.length,
      claimed,
      dispatched,
      succeeded,
      failed,
    };
  };
}
