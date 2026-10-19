import { buildDealsByPositionMessage, buildOrderDetailsMessage, buildOrdersByPositionMessage, buildReconcileMessage } from './ctrader_protocol.js';

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
  } else if (orderStatus === 3 || orderStatus === 4 || orderStatus === 5) {
    status = 'CANCELLED';
  } else {
    return unresolved(context, 'UNSUPPORTED_ORDER_STATUS');
  }
  if (executedVolume > 0 && byPosition.size === 0) return unresolved(context, 'FILLS_NOT_MAPPED_TO_POSITION');

  const fills = [...byPosition.values()].sort((a, b) => a.positionId.localeCompare(b.positionId)).map((row) => {
    const dealIds = [...new Set(row.dealIds)].sort();
    return {
      dealId: dealIds[0], dealIds, positionId: row.positionId, lots: Number(row.lots.toFixed(12)),
      isOpen: context.openPositionIds instanceof Set && context.openPositionIds.has(row.positionId),
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
    const reconciliation = await context.session.request(buildReconcileMessage({
      clientMsgId: `lifecycle-reconcile-${String(context.brokerOrderId)}`.slice(0, 64),
      accountId: context.accountId,
      returnProtectionOrders: false,
    }), { successPayloadTypes: [2125] });
    const positions = reconciliation?.payload?.position;
    if (Number(reconciliation?.payloadType) !== 2125
      || String(reconciliation?.payload?.ctidTraderAccountId ?? '') !== String(context.accountId)
      || !Array.isArray(positions)) return unresolved(context, 'OPEN_POSITION_RECONCILIATION_UNAVAILABLE');
    const openPositionIds = new Set(positions.map((position) => String(position?.positionId ?? '')).filter(Boolean));
    return normalizeCTraderOrderDetails(response, { ...context, openPositionIds });
  } catch {
    return unresolved(context, 'BROKER_HISTORY_UNAVAILABLE');
  }
}

/** Read-only exact position history used to prove broker-side TP closure. */
export async function readCTraderPositionCloseStatus(context = {}) {
  if (!context.session?.request) throw new TypeError('authenticated cTrader session required');
  const positionId = String(context.brokerPositionId ?? '').trim();
  const accountId = String(context.accountId ?? '').trim();
  const protocolLotSize = Number(context.protocolLotSize);
  const side = String(context.side ?? '').toUpperCase();
  if (!/^\d+$/.test(positionId) || !/^\d+$/.test(accountId) || !(protocolLotSize > 0) || !['BUY', 'SELL'].includes(side)) {
    return unresolved(context, 'POSITION_CLOSE_REQUEST_INVALID');
  }
  const position = Number(positionId);
  const account = Number(accountId);
  const fromTimestamp = Math.max(0, Math.trunc(Number(context.openedAt ?? context.createdAt ?? 0)));
  const toTimestamp = Math.trunc(Number(context.nowMs ?? Date.now()));
  const requestId = (prefix) => context.session.nextClientMsgId?.(prefix)
    || `${prefix}-${positionId}-${toTimestamp}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
  try {
    const [dealResponse, orderResponse, reconcile] = await Promise.all([
      context.session.request(buildDealsByPositionMessage({ clientMsgId: requestId('tp-deals'), accountId: account, positionId: position, fromTimestamp, toTimestamp }), { successPayloadTypes: [2180] }),
      context.session.request(buildOrdersByPositionMessage({ clientMsgId: requestId('tp-orders'), accountId: account, positionId: position, fromTimestamp, toTimestamp }), { successPayloadTypes: [2184] }),
      context.session.request(buildReconcileMessage({ clientMsgId: requestId('tp-reconcile'), accountId: account, returnProtectionOrders: true }), { successPayloadTypes: [2125] }),
    ]);
    const validResponse = (response, type) => Number(response?.payloadType) === type
      && String(response?.payload?.ctidTraderAccountId ?? '') === accountId
      && response?.payload?.hasMore !== true;
    if (!validResponse(dealResponse, 2180) || !validResponse(orderResponse, 2184)
      || Number(reconcile?.payloadType) !== 2125
      || String(reconcile?.payload?.ctidTraderAccountId ?? '') !== accountId
      || !Array.isArray(reconcile?.payload?.position)) return unresolved(context, 'POSITION_CLOSE_HISTORY_UNRESOLVED');
    const rawDeals = dealResponse.payload.deal;
    const rawOrders = orderResponse.payload.order;
    if (!Array.isArray(rawDeals) || !Array.isArray(rawOrders)) return unresolved(context, 'POSITION_CLOSE_HISTORY_UNRESOLVED');
    const open = reconcile.payload.position.some((row) => String(row?.positionId ?? '') === positionId);
    const closingSide = side === 'BUY' ? 2 : 1;
    const openingDeals = rawDeals.filter((deal) => String(deal?.positionId ?? '') === positionId
      && Number(deal?.dealStatus) === 2 && Number(deal?.tradeSide) !== closingSide);
    const closingDeals = rawDeals.filter((deal) => String(deal?.positionId ?? '') === positionId
      && Number(deal?.dealStatus) === 2 && Number(deal?.tradeSide) === closingSide);
    if (openingDeals.length + closingDeals.length !== rawDeals.length) return unresolved(context, 'POSITION_DEAL_IDENTITY_OR_STATUS_INVALID');
    const ordersById = new Map(rawOrders.map((order) => [String(order?.orderId ?? ''), order]));
    const deals = closingDeals.map((deal) => ({
      dealId: String(deal.dealId ?? ''), positionId, lots: Number(deal.filledVolume) / protocolLotSize,
      executionPrice: deal.executionPrice == null ? null : Number(deal.executionPrice), orderId: String(deal.orderId ?? ''),
    }));
    const closingOrders = [...new Set(deals.map((deal) => deal.orderId))].map((orderId) => {
      const order = ordersById.get(orderId);
      if (!order) return null;
      return { orderId, positionId: String(order.positionId ?? ''), closingOrder: order.closingOrder === true,
        orderType: String(order.orderType ?? ''), takeProfit: order.takeProfit == null ? null : Number(order.takeProfit),
        stopLoss: order.stopLoss == null ? null : Number(order.stopLoss), isStopOut: order.isStopOut === true };
    });
    if (closingOrders.some((order) => !order)) return unresolved(context, 'POSITION_CLOSING_ORDER_UNAVAILABLE');
    const closeVolumes = closingDeals.map((deal) => Number(deal?.closePositionDetail?.closedVolume ?? deal?.filledVolume));
    if (closeVolumes.some((value) => !(value > 0))) return unresolved(context, 'POSITION_CLOSE_VOLUME_INVALID');
    const initialLots = openingDeals.reduce((sum, deal) => sum + Number(deal.filledVolume) / protocolLotSize, 0);
    const closedLots = closingDeals.reduce((sum, deal) => sum + Number(deal.closePositionDetail?.closedVolume ?? deal.filledVolume) / protocolLotSize, 0);
    return {
      ...context,
      snapshot: { accountId, positionId, environment: String(context.environment || ''), isLive: context.isLive === true,
        isOpen: open, initialLots, closedLots, deals, closingOrders,
        tickSize: Number(context.tickSize) || null, observedAt: toTimestamp },
    };
  } catch {
    return unresolved(context, 'BROKER_POSITION_HISTORY_UNAVAILABLE');
  }
}

/** Read-only current-position protection snapshot. Reconcile is account-bound
 * and the exact position id/symbol/side are checked before returning values. */
export async function readCTraderPositionStatus(context = {}) {
  if (!context.session?.request) throw new TypeError('authenticated cTrader session required');
  const positionId = String(context.brokerPositionId ?? '').trim();
  const accountId = String(context.accountId ?? '').trim();
  if (!/^\d+$/.test(positionId) || !/^\d+$/.test(accountId)) return unresolved(context, 'POSITION_STATUS_REQUEST_INVALID');
  try {
    const response = await context.session.request(buildReconcileMessage({
      clientMsgId: `position-status-${positionId}`.slice(0, 64), accountId: Number(accountId), returnProtectionOrders: false,
    }), { successPayloadTypes: [2125] });
    if (Number(response?.payloadType) !== 2125 || String(response?.payload?.ctidTraderAccountId ?? '') !== accountId
      || !Array.isArray(response?.payload?.position)) return unresolved(context, 'POSITION_STATUS_UNRESOLVED');
    const matches = response.payload.position.filter((row) => String(row?.positionId ?? '') === positionId);
    if (matches.length === 0) return { ...context, snapshot: { accountId, positionId, isOpen: false, observedAt: Number(context.nowMs ?? Date.now()) } };
    if (matches.length !== 1) return unresolved(context, 'POSITION_STATUS_IDENTITY_AMBIGUOUS');
    const row = matches[0];
    const tradeData = row.tradeData || {};
    const symbolId = Number(tradeData.symbolId ?? row.symbolId);
    if (context.expectedPlatformSymbolId != null && String(symbolId) !== String(context.expectedPlatformSymbolId)) return unresolved(context, 'POSITION_STATUS_SYMBOL_MISMATCH');
    const tradeSide = Number(tradeData.tradeSide ?? row.tradeSide);
    const side = tradeSide === 1 ? 'BUY' : tradeSide === 2 ? 'SELL' : null;
    if (!side) return unresolved(context, 'POSITION_STATUS_SIDE_UNCERTAIN');
    const protocolLotSize = Number(context.protocolLotSize);
    const volume = Number(tradeData.volume ?? row.volume);
    if (!(protocolLotSize > 0) || !(volume > 0)) return unresolved(context, 'POSITION_STATUS_VOLUME_UNCERTAIN');
    const finiteProtection = (value) => {
      if (value == null || Number(value) === 0) return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
    };
    const stopLoss = finiteProtection(row.stopLoss);
    const takeProfit = finiteProtection(row.takeProfit);
    return { ...context, snapshot: {
      accountId, positionId, isOpen: true, symbolId, side, volume: volume / protocolLotSize,
      ...(stopLoss !== undefined ? { stopLoss } : {}), ...(takeProfit !== undefined ? { takeProfit } : {}),
      openedAt: Number(row.openTimestamp ?? row.utcLastUpdateTimestamp ?? 0), observedAt: Number(context.nowMs ?? Date.now()),
    } };
  } catch {
    return unresolved(context, 'BROKER_POSITION_STATUS_UNAVAILABLE');
  }
}
