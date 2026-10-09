import { buildOrderDetailsMessage } from './ctrader_protocol.js';

function unresolved(context, reason) {
  return {
    accountRowId: String(context.accountRowId),
    brokerAccountNumber: String(context.brokerAccountNumber),
    serverName: String(context.serverName || ''),
    environment: String(context.environment || ''),
    isLive: typeof context.isLive === 'boolean' ? context.isLive : null,
    snapshot: { status: 'UNRESOLVED', remainingLots: null, fills: [], observedAt: Number(context.nowMs), sourceVersion: null, reason },
  };
}

export function normalizeCTraderOrderDetails(response, context = {}) {
  const accountId = String(context.accountId ?? '');
  const orderId = String(context.brokerOrderId ?? '');
  const protocolLotSize = Number(context.protocolLotSize);
  const payload = response?.payload || {};
  const order = payload.order;
  if (Number(response?.payloadType) !== 2182
    || String(payload.ctidTraderAccountId ?? '') !== accountId
    || String(order?.orderId ?? '') !== orderId
    || (context.expectedPlatformSymbolId != null && String(order?.tradeData?.symbolId ?? '') !== String(context.expectedPlatformSymbolId))
    || !(protocolLotSize > 0)) return unresolved(context, 'IDENTITY_OR_CATALOG_MISMATCH');

  const orderVolume = Number(order?.tradeData?.volume);
  const executedVolume = Number(order?.executedVolume ?? 0);
  if (!(Number.isFinite(orderVolume) && orderVolume > 0)
    || !(Number.isFinite(executedVolume) && executedVolume >= 0)
    || executedVolume > orderVolume) return unresolved(context, 'INVALID_ORDER_VOLUME');

  const deals = Array.isArray(payload.deal) ? payload.deal : [];
  const byPosition = new Map();
  let totalDealVolume = 0;
  for (const deal of deals) {
    const dealId = String(deal?.dealId ?? '').trim();
    const positionId = String(deal?.positionId ?? '').trim();
    const filledVolume = Number(deal?.filledVolume);
    const dealStatus = Number(deal?.dealStatus);
    const executionPrice = deal?.executionPrice == null ? undefined : Number(deal.executionPrice);
    if (String(deal?.orderId ?? '') !== orderId || !dealId || !positionId
      || !(Number.isFinite(filledVolume) && filledVolume > 0)
      || ![2, 3].includes(dealStatus)
      || (executionPrice != null && !(Number.isFinite(executionPrice) && executionPrice > 0))) {
      return unresolved(context, 'AMBIGUOUS_DEAL_MAPPING');
    }
    const row = byPosition.get(positionId) || { positionId, lots: 0, dealIds: [], pricedVolume: 0, weightedPrice: 0 };
    row.lots += filledVolume / protocolLotSize;
    row.dealIds.push(dealId);
    if (Number.isFinite(executionPrice)) {
      row.pricedVolume += filledVolume;
      row.weightedPrice += executionPrice * filledVolume;
    }
    byPosition.set(positionId, row);
    totalDealVolume += filledVolume;
  }
  if (totalDealVolume !== executedVolume) return unresolved(context, 'DEAL_VOLUME_MISMATCH');

  const orderStatus = Number(order.orderStatus);
  const remainingProtocolVolume = orderVolume - executedVolume;
  let status;
  if (orderStatus === 2) {
    if (remainingProtocolVolume !== 0 || executedVolume === 0) return unresolved(context, 'FILLED_STATUS_VOLUME_MISMATCH');
    status = 'FILLED';
  } else if (orderStatus === 1) {
    status = executedVolume > 0 ? 'PARTIALLY_FILLED' : 'PENDING';
  } else if (orderStatus === 4 || orderStatus === 5) {
    status = 'CANCELLED';
  } else {
    return unresolved(context, 'UNSUPPORTED_ORDER_STATUS');
  }
  if (executedVolume > 0 && byPosition.size === 0) return unresolved(context, 'FILLS_NOT_MAPPED_TO_POSITION');

  const fills = [...byPosition.values()].sort((a, b) => a.positionId.localeCompare(b.positionId)).map((row) => {
    const dealIds = [...new Set(row.dealIds)].sort();
    return {
      dealId: dealIds[0], dealIds, positionId: row.positionId, lots: Number(row.lots.toFixed(12)),
      ...(row.pricedVolume > 0 ? { fillPrice: Number((row.weightedPrice / row.pricedVolume).toFixed(12)) } : {}),
    };
  });
  const observedAt = Number(order.utcLastUpdateTimestamp ?? context.nowMs);
  return {
    accountRowId: String(context.accountRowId),
    brokerAccountNumber: String(context.brokerAccountNumber),
    serverName: String(context.serverName || ''),
    environment: String(context.environment || ''),
    isLive: typeof context.isLive === 'boolean' ? context.isLive : null,
    snapshot: {
      status,
      remainingLots: status === 'CANCELLED' ? 0 : Number((remainingProtocolVolume / protocolLotSize).toFixed(12)),
      fills,
      observedAt: Number.isFinite(observedAt) ? observedAt : Number(context.nowMs),
      sourceVersion: `${orderStatus}:${executedVolume}:${order.utcLastUpdateTimestamp ?? ''}`,
    },
  };
}

export async function readCTraderPendingOrderStatus(context = {}) {
  if (!context.session?.request) throw new TypeError('authenticated cTrader session required');
  const request = buildOrderDetailsMessage({
    clientMsgId: `lifecycle-${String(context.brokerOrderId)}`.slice(0, 64),
    accountId: context.accountId,
    orderId: context.brokerOrderId,
  });
  try {
    const response = await context.session.request(request, { successPayloadTypes: [2182] });
    return normalizeCTraderOrderDetails(response, context);
  } catch {
    return unresolved(context, 'BROKER_HISTORY_UNAVAILABLE');
  }
}
