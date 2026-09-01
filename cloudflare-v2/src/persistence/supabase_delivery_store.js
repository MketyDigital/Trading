function publicResult(row) {
  if (!row?.response_payload) return undefined;
  return row.response_payload;
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

    if (!error) return { duplicate: false, row: data?.[0] || null };
    if (String(error.code) !== '23505') throw new Error(`delivery reservation failed: ${error.message}`);

    const existing = await this.find(key);
    return { duplicate: true, result: publicResult(existing), row: existing };
  }

  async complete(idempotencyKey, result) {
    const { error } = await this.supabase
      .from('destination_deliveries')
      .update({ status: 'SUCCEEDED', response_payload: result, error_code: null, updated_at: new Date().toISOString() })
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', String(idempotencyKey));
    if (error) throw new Error(`delivery completion persistence failed: ${error.message}`);
  }

  async fail(idempotencyKey, failure = {}) {
    const errorCode = String(failure?.error || failure?.code || 'DELIVERY_FAILED').slice(0, 500);
    const { error } = await this.supabase
      .from('destination_deliveries')
      .update({ status: 'FAILED', error_code: errorCode, response_payload: failure?.result || null, updated_at: new Date().toISOString() })
      .eq('workspace_id', this.workspaceId)
      .eq('idempotency_key', String(idempotencyKey));
    if (error) throw new Error(`delivery failure persistence failed: ${error.message}`);
  }
}
