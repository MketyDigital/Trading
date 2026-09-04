function text(value) {
  return String(value ?? '').trim();
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function persistedBinding(row = {}) {
  const request = row.request_payload;
  const response = row.response_payload;
  const action = request?.action;

  const workspaceId = text(row.workspace_id);
  const eventId = text(row.trading_event_id);
  const accountId = text(request?.accountId);
  const groupId = text(request?.groupId);
  const legId = text(action?.legId);
  const deliveryKey = text(row.idempotency_key);
  const actionKey = text(action?.idempotencyKey);
  const destinationRef = text(row.destination_ref);
  const destinationType = text(row.destination_type).toLowerCase();
  const requestDestinationType = text(request?.destinationType).toLowerCase();

  if (!workspaceId || !eventId || !accountId || !groupId || !legId || !deliveryKey || !actionKey) {
    throw new Error('binding repair durable identity is incomplete');
  }
  if (deliveryKey !== actionKey) throw new Error('binding repair idempotency identity mismatch');
  if (destinationRef !== `trade-account:${accountId}`) {
    throw new Error('binding repair destination account mismatch');
  }
  if (!['mt5', 'ctrader'].includes(destinationType)) {
    throw new Error('binding repair destination is not a broker account');
  }
  if (requestDestinationType && requestDestinationType !== destinationType) {
    throw new Error('binding repair destination type mismatch');
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('binding repair broker result is unavailable');
  }

  const brokerPositionId = response.brokerPositionId == null ? null : text(response.brokerPositionId);
  const brokerOrderId = response.brokerOrderId == null ? null : text(response.brokerOrderId);
  const brokerDealId = response.brokerDealId == null ? null : text(response.brokerDealId);
  const fillPrice = finiteOrNull(response.fillPrice);

  if (!brokerPositionId && !brokerOrderId && !brokerDealId && fillPrice == null) {
    throw new Error('binding repair broker identifiers are unavailable');
  }

  return {
    workspaceId,
    eventId,
    accountId,
    groupId,
    legId,
    brokerPositionId: brokerPositionId || null,
    brokerOrderId: brokerOrderId || null,
    brokerDealId: brokerDealId || null,
    fillPrice,
  };
}

async function clearRepairMarker(supabase, row, now) {
  const query = supabase
    .from('destination_deliveries')
    .update({
      failure_class: null,
      error_code: null,
      error_body: null,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('workspace_id', row.workspace_id)
    .eq('status', 'SUCCEEDED')
    .eq('failure_class', 'STATE_BINDING_PENDING');

  const { error } = await query;
  if (error) throw new Error(`binding repair completion persistence failed: ${error.message}`);
}

/**
 * Repairs Trade State from already-persisted successful broker deliveries.
 * This path intentionally has no broker executor dependency: broker SUCCEEDED
 * remains terminal, while only the state-binding marker is retried.
 */
export async function repairExecutionBindings({
  supabase,
  stateBinder,
  limit = 50,
  now = new Date().toISOString(),
} = {}) {
  if (!supabase?.from) throw new TypeError('supabase client is required');
  if (typeof stateBinder !== 'function') throw new TypeError('stateBinder is required');
  const boundedLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const nowIso = new Date(now).toISOString();

  const { data, error } = await supabase
    .from('destination_deliveries')
    .select('*')
    .eq('status', 'SUCCEEDED')
    .eq('failure_class', 'STATE_BINDING_PENDING')
    .order('updated_at', { ascending: true })
    .limit(boundedLimit);
  if (error) throw new Error(`binding repair scan failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  let repaired = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const binding = persistedBinding(row);
      await stateBinder(binding);
      await clearRepairMarker(supabase, row, nowIso);
      repaired += 1;
    } catch {
      // Leave SUCCEEDED + STATE_BINDING_PENDING intact for a later repair pass.
      // Never downgrade to RETRYABLE and never resend the broker action.
      failed += 1;
    }
  }

  return { scanned: rows.length, repaired, failed };
}

export { persistedBinding as bindingFromSuccessfulDelivery };
