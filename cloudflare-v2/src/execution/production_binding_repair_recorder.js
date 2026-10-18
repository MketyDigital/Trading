function text(value) {
  return String(value ?? '').trim();
}

function errorBody(message) {
  return { message: text(message || 'Trade State binding failed').slice(0, 1000) };
}

/**
 * Returns a recorder that can only mark an already-SUCCEEDED broker delivery
 * for state-binding repair. It accepts durable locator identity only; broker
 * identifiers remain sourced later from the persisted response_payload.
 */
export function createProductionBindingRepairRecorder({
  supabase,
  persistenceRuntime = null,
  workspaceId,
  tradingEventId,
} = {}) {
  const boundWorkspaceId = text(workspaceId);
  const boundEventId = text(tradingEventId);

  return async function bindingRepairRecorder(locator = {}) {
    if (!supabase?.from && !persistenceRuntime) throw new TypeError('Trading persistence is required');
    const requestedWorkspaceId = text(locator.workspaceId);
    const requestedEventId = text(locator.eventId);
    const accountId = text(locator.accountId);
    const groupId = text(locator.groupId);
    const legId = text(locator.legId);
    const idempotencyKey = text(locator.idempotencyKey);

    if (!boundWorkspaceId || !boundEventId) throw new Error('binding repair authority is not bound');
    if (requestedWorkspaceId !== boundWorkspaceId || requestedEventId !== boundEventId) {
      throw new Error('binding repair authority mismatch');
    }
    if (!accountId || !groupId || !legId || !idempotencyKey) {
      throw new Error('binding repair locator is incomplete');
    }

    if (persistenceRuntime?.delivery) {
      const repo = persistenceRuntime.delivery({
        workspaceId: boundWorkspaceId,
        destinationType: 'trade_account',
        destinationRef: `trade-account:${accountId}`,
        tradingEventId: boundEventId,
      });
      const row = await repo.findForStateBinding(idempotencyKey);
      if (!row) throw new Error('successful broker delivery for binding repair was not found');
      const request = row.request_payload;
      if (text(request?.accountId) !== accountId || text(request?.groupId) !== groupId) throw new Error('binding repair durable account/group identity mismatch');
      if (text(request?.action?.legId) !== legId || text(request?.action?.idempotencyKey) !== idempotencyKey) throw new Error('binding repair durable action identity mismatch');
      if (!row.response_payload || typeof row.response_payload !== 'object') throw new Error('binding repair broker result is not durable');
      await repo.markBindingPending(idempotencyKey, { code: 'STATE_BIND_FAILED', message: errorBody('Trade State binding failed after successful broker delivery').message });
      return { recorded: true, deliveryId: row.id };
    }

    const { data: row, error: lookupError } = await supabase
      .from('destination_deliveries')
      .select('*')
      .eq('workspace_id', boundWorkspaceId)
      .eq('trading_event_id', boundEventId)
      .eq('idempotency_key', idempotencyKey)
      .eq('destination_ref', `trade-account:${accountId}`)
      .eq('status', 'SUCCEEDED')
      .maybeSingle();
    if (lookupError) throw new Error(`binding repair delivery lookup failed: ${lookupError.message}`);
    if (!row) throw new Error('successful broker delivery for binding repair was not found');

    const request = row.request_payload;
    if (text(request?.accountId) !== accountId || text(request?.groupId) !== groupId) {
      throw new Error('binding repair durable account/group identity mismatch');
    }
    if (text(request?.action?.legId) !== legId || text(request?.action?.idempotencyKey) !== idempotencyKey) {
      throw new Error('binding repair durable action identity mismatch');
    }
    if (!row.response_payload || typeof row.response_payload !== 'object') {
      throw new Error('binding repair broker result is not durable');
    }

    const { error } = await supabase
      .from('destination_deliveries')
      .update({
        failure_class: 'STATE_BINDING_PENDING',
        error_code: 'STATE_BIND_FAILED',
        error_body: errorBody('Trade State binding failed after successful broker delivery'),
        next_attempt_at: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('workspace_id', boundWorkspaceId)
      .eq('trading_event_id', boundEventId)
      .eq('idempotency_key', idempotencyKey)
      .eq('status', 'SUCCEEDED');
    if (error) throw new Error(`binding repair marker persistence failed: ${error.message}`);

    return { recorded: true, deliveryId: row.id };
  };
}
