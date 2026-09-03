function publicResult(row) {
  if (!row?.response_payload) return undefined;
  return row.response_payload;
}

function boundedErrorCode(failure = {}, fallback = 'DELIVERY_FAILED') {
  return String(failure?.code || failure?.error || fallback).slice(0, 500);
}

function requiredTimestamp(value, name) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${name} is invalid`);
  return date.toISOString();
}

export class SupabaseDeliveryStore {
  constructor(supabase, { workspaceId, destinationType, destinationRef = null, tradingEventId = null } = {}) {
    if (!supabase?.from) throw new TypeError('supabase client is required');
    if (!workspaceId || !destinationType) throw new TypeError('workspaceId and destinationType are required');
    this.supabase = supabase;
    this.workspaceId = String(workspaceId);
    this.destinationType = String(destinationType);
    this.destinationRef = destinationRef == null ? null : String(destinationRef);
    this.tradingEventId = tradingEventId || null;
  }

  async find(idempotencyKey) {
    const { data, error } = await this.supabase
      .from('destination_deliveries')
      .select('*')
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', String(idempotencyKey))
      .maybeSingle();
    if (error) throw new Error(`delivery lookup failed: ${error.message}`);
    return data || null;
  }

  async reserve(idempotencyKey, requestPayload = null) {
    const key = String(idempotencyKey || '');
    if (!key) throw new TypeError('idempotencyKey is required');
    const { data, error } = await this.supabase
      .from('destination_deliveries')
      .insert({
        workspace_id: this.workspaceId,
        trading_event_id: this.tradingEventId,
        destination_type: this.destinationType,
        destination_ref: this.destinationRef,
        idempotency_key: key,
        status: 'PENDING',
        request_payload: requestPayload,
        attempt_count: 1,
      })
      .select('*');

    if (!error) return { ok: true, duplicate: false, row: data?.[0] || null };
    if (String(error.code) !== '23505') throw new Error(`delivery reservation failed: ${error.message}`);

    const existing = await this.find(key);
    return { ok: true, duplicate: true, result: publicResult(existing), row: existing };
  }

  async complete(idempotencyKey, result) {
    const { error } = await this.supabase
      .from('destination_deliveries')
      .update({
        status: 'SUCCEEDED',
        response_payload: result,
        error_code: null,
        failure_class: null,
        next_attempt_at: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', String(idempotencyKey));
    if (error) throw new Error(`delivery completion persistence failed: ${error.message}`);
  }

  async fail(idempotencyKey, failure = {}) {
    const { error } = await this.supabase
      .from('destination_deliveries')
      .update({
        status: 'FAILED',
        error_code: boundedErrorCode(failure),
        failure_class: 'TERMINAL',
        next_attempt_at: null,
        lease_expires_at: null,
        response_payload: failure?.result || null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', String(idempotencyKey));
    if (error) throw new Error(`delivery failure persistence failed: ${error.message}`);
  }

  async markRetryable(idempotencyKey, failure = {}, { nextAttemptAt } = {}) {
    const key = String(idempotencyKey || '');
    if (!key) throw new TypeError('idempotencyKey is required');
    const nextAttemptIso = requiredTimestamp(nextAttemptAt, 'nextAttemptAt');
    const { error } = await this.supabase
      .from('destination_deliveries')
      .update({
        status: 'RETRYABLE',
        error_code: boundedErrorCode(failure, 'DELIVERY_RETRYABLE'),
        failure_class: 'RETRYABLE',
        next_attempt_at: nextAttemptIso,
        lease_expires_at: null,
        response_payload: failure?.result || null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', key);
    if (error) throw new Error(`delivery retry persistence failed: ${error.message}`);
  }

  async markUncertain(idempotencyKey, failure = {}) {
    const key = String(idempotencyKey || '');
    if (!key) throw new TypeError('idempotencyKey is required');
    const { error } = await this.supabase
      .from('destination_deliveries')
      .update({
        status: 'UNCERTAIN',
        error_code: boundedErrorCode(failure, 'DELIVERY_UNCERTAIN'),
        failure_class: 'UNCERTAIN',
        next_attempt_at: null,
        lease_expires_at: null,
        response_payload: failure?.result || null,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', key);
    if (error) throw new Error(`delivery uncertainty persistence failed: ${error.message}`);
  }

  async claimRetry(idempotencyKey, { now = new Date().toISOString(), leaseUntil } = {}) {
    const key = String(idempotencyKey || '');
    if (!key) throw new TypeError('idempotencyKey is required');
    const nowIso = requiredTimestamp(now, 'now');
    const leaseIso = requiredTimestamp(leaseUntil, 'leaseUntil');
    if (new Date(leaseIso).getTime() <= new Date(nowIso).getTime()) {
      throw new TypeError('leaseUntil must be after now');
    }

    const row = await this.find(key);
    if (!row || row.status !== 'RETRYABLE' || !row.next_attempt_at) return { claimed: false, row: null };
    if (new Date(row.next_attempt_at).getTime() > new Date(nowIso).getTime()) return { claimed: false, row: null };

    const attemptCount = Number(row.attempt_count || 0);
    const { data, error } = await this.supabase
      .from('destination_deliveries')
      .update({
        status: 'PENDING',
        attempt_count: attemptCount + 1,
        last_attempt_at: nowIso,
        lease_expires_at: leaseIso,
        next_attempt_at: null,
        failure_class: null,
        error_code: null,
        updated_at: nowIso,
      })
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', key)
      .eq('status', 'RETRYABLE')
      .eq('attempt_count', attemptCount)
      .eq('next_attempt_at', row.next_attempt_at)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`delivery retry claim failed: ${error.message}`);
    return data ? { claimed: true, row: data } : { claimed: false, row: null };
  }
}

export function createSupabaseDeliveryStore(supabase, options = {}) {
  return new SupabaseDeliveryStore(supabase, options);
}
