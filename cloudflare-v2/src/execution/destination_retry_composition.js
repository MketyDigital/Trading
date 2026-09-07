function requireSupabase(supabase) {
  if (!supabase?.from) throw new TypeError('supabase client is required');
}

function requireKeyMatch(expected, actual) {
  if (String(actual) !== String(expected)) {
    throw new Error('claimed retry key mismatch');
  }
}

function dueTime(row = {}) {
  const value = row.status === 'PENDING' ? row.lease_expires_at : row.next_attempt_at;
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

export async function listDueDestinationRetries({
  supabase,
  now,
  limit = 20,
  maxAttempts = 5,
} = {}) {
  requireSupabase(supabase);
  const normalizedNow = String(now || '');
  if (!normalizedNow) throw new TypeError('now is required');
  const safeLimit = Math.max(1, Math.trunc(Number(limit) || 20));

  // RETRYABLE rows are new logical retry attempts and remain subject to the
  // attempt budget. PENDING rows with an expired non-null lease represent a
  // worker crash after an earlier atomic claim; reclaiming them continues that
  // same logical attempt rather than consuming a new attempt budget slot.
  const [retryableResult, expiredClaimResult] = await Promise.all([
    supabase
      .from('destination_deliveries')
      .select('*')
      .eq('status', 'RETRYABLE')
      .lte('next_attempt_at', normalizedNow)
      .lt('attempt_count', Number(maxAttempts))
      .or(`lease_expires_at.is.null,lease_expires_at.lt.${normalizedNow}`)
      .order('next_attempt_at', { ascending: true })
      .limit(safeLimit),
    supabase
      .from('destination_deliveries')
      .select('*')
      .eq('status', 'PENDING')
      .lt('lease_expires_at', normalizedNow)
      .order('lease_expires_at', { ascending: true })
      .limit(safeLimit),
  ]);

  if (retryableResult?.error) throw new Error(`destination retry scan failed: ${retryableResult.error.message}`);
  if (expiredClaimResult?.error) throw new Error(`destination retry crash-recovery scan failed: ${expiredClaimResult.error.message}`);

  const retryable = Array.isArray(retryableResult?.data) ? retryableResult.data : [];
  const expiredClaims = Array.isArray(expiredClaimResult?.data) ? expiredClaimResult.data : [];
  return [...retryable, ...expiredClaims]
    .sort((left, right) => dueTime(left) - dueTime(right))
    .slice(0, safeLimit);
}

export function createContextualDeliveryStore(baseStore, context = {}) {
  if (!baseStore?.reserve) throw new TypeError('base delivery store is required');
  const trustedContext = {
    accountId: context.accountId,
    groupId: context.groupId,
    destinationType: context.destinationType,
  };

  return {
    async reserve(key, payload = {}) {
      return baseStore.reserve(key, {
        ...payload,
        destinationType: trustedContext.destinationType,
        accountId: trustedContext.accountId,
        groupId: trustedContext.groupId,
      });
    },
    complete: (...args) => baseStore.complete(...args),
    fail: (...args) => baseStore.fail(...args),
    markRetryable: (...args) => baseStore.markRetryable(...args),
    markUncertain: (...args) => baseStore.markUncertain(...args),
  };
}

export function createClaimedDeliveryStore(baseStore, claimedDelivery = {}) {
  if (!baseStore) throw new TypeError('base delivery store is required');
  const claimedKey = String(claimedDelivery.idempotency_key || '');
  if (!claimedKey) throw new TypeError('claimed delivery idempotency key is required');
  let consumed = false;

  const guarded = (method) => async (key, ...args) => {
    requireKeyMatch(claimedKey, key);
    if (typeof baseStore[method] !== 'function') {
      throw new TypeError(`base delivery store ${method} is required`);
    }
    return baseStore[method](key, ...args);
  };

  return {
    async reserve(key) {
      requireKeyMatch(claimedKey, key);
      if (consumed) throw new Error('claimed retry reservation already consumed');
      consumed = true;
      return { ok: true, duplicate: false, row: claimedDelivery };
    },
    complete: guarded('complete'),
    fail: guarded('fail'),
    markRetryable: guarded('markRetryable'),
    markUncertain: guarded('markUncertain'),
  };
}
