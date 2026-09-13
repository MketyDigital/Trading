function text(value) { return String(value ?? '').trim(); }

function payloadFrom(binding = {}) {
  const payload = {};
  for (const key of ['brokerPositionId', 'brokerOrderId', 'brokerDealId', 'actionType', 'status', 'failureCode']) {
    if (binding[key] != null && text(binding[key])) payload[key] = String(binding[key]);
  }
  for (const key of ['fillPrice', 'executedLots', 'volumeStepLots', 'minimumLots']) {
    const value = Number(binding[key]);
    if (Number.isFinite(value)) payload[key] = value;
  }
  return payload;
}

export function createProductionTradeStateBinder({ env = {}, workspaceId } = {}) {
  const boundWorkspaceId = text(workspaceId);
  if (!boundWorkspaceId) throw new TypeError('workspaceId is required');

  return async function stateBinder(binding = {}) {
    if (text(binding.workspaceId) !== boundWorkspaceId) throw new Error('production execution workspace mismatch');
    const groupId = text(binding.groupId);
    const legId = text(binding.legId);
    if (!groupId) throw new TypeError('groupId is required');
    if (!legId) throw new TypeError('legId is required');

    const token = text(env.TRADE_STATE_INTERNAL_TOKEN);
    if (!token) throw new Error('TRADE_STATE_INTERNAL_TOKEN is not configured');
    const namespace = env.TRADE_STATE_NAMESPACE;
    if (!namespace?.idFromName || !namespace?.get) throw new Error('TRADE_STATE_NAMESPACE is not configured');

    const payload = payloadFrom(binding);
    if (Object.keys(payload).length === 0) throw new Error('trade lifecycle binding payload is required');

    const stub = namespace.get(namespace.idFromName(boundWorkspaceId));
    const response = await stub.fetch(
      `https://trade-state.internal/groups/${encodeURIComponent(groupId)}/legs/${encodeURIComponent(legId)}/execution`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mkety-internal-token': token,
        },
        body: JSON.stringify(payload),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Trade State binding failed (${response.status}): ${body?.error || 'unknown error'}`);
    return body;
  };
}

export { payloadFrom as productionTradeStateBindingPayload };
