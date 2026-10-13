function text(value) { return String(value ?? '').trim(); }
function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function approx(left, right, tolerance = 1e-8) {
  const a = number(left); const b = number(right);
  return a != null && b != null && Math.abs(a - b) <= tolerance;
}
function unresolved(reason = 'BROKER_CLOSE_UNRESOLVED') { return { status: 'UNRESOLVED', reason }; }

function fullClose(snapshot, deals) {
  const expectedLots = number(snapshot?.initialLots);
  const closedLots = number(snapshot?.closedLots);
  const dealLots = deals.reduce((sum, deal) => sum + (number(deal?.lots) ?? 0), 0);
  return expectedLots != null && expectedLots > 0
    && snapshot?.isOpen === false
    && (closedLots != null ? approx(closedLots, expectedLots) : approx(dealLots, expectedLots));
}

function confirmed(snapshot, deals) {
  if (!Array.isArray(deals) || deals.length === 0 || !fullClose(snapshot, deals)) return null;
  const ids = deals.map((deal) => text(deal?.dealId)).filter(Boolean);
  if (ids.length !== deals.length || new Set(ids).size !== ids.length) return null;
  return { status: 'TP_CONFIRMED', positionId: text(snapshot.positionId), dealIds: ids.sort() };
}

function classifyMt5(leg, snapshot) {
  const positionId = text(leg?.brokerPositionId);
  const deals = snapshot.deals;
  if (!positionId || text(snapshot.positionId) !== positionId || !Array.isArray(deals) || !deals.length) return unresolved('BROKER_POSITION_IDENTITY_MISMATCH');
  const exactDeals = deals.filter((deal) => text(deal?.positionId) === positionId);
  if (exactDeals.length !== deals.length) return unresolved('BROKER_DEAL_IDENTITY_MISMATCH');
  const isTpExit = (deal) => ['TP', 'TAKE_PROFIT', '5'].includes(text(deal?.reason).toUpperCase())
    && ['OUT', '1'].includes(text(deal?.entry).toUpperCase());
  if (!exactDeals.every(isTpExit)) return unresolved('BROKER_EXIT_NOT_TAKE_PROFIT');
  const result = confirmed(snapshot, exactDeals);
  return result || unresolved('BROKER_TP_CLOSE_INCOMPLETE');
}

function classifyCTrader(leg, snapshot) {
  const positionId = text(leg?.brokerPositionId);
  const deals = snapshot.deals;
  const orders = snapshot.closingOrders;
  const target = number(leg?.takeProfit);
  const tickSize = number(snapshot.tickSize);
  if (!positionId || text(snapshot.positionId) !== positionId || target == null || !(tickSize > 0)
    || !Array.isArray(deals) || !deals.length || !Array.isArray(orders) || !orders.length) return unresolved('BROKER_POSITION_IDENTITY_MISMATCH');
  if (deals.some((deal) => text(deal?.positionId) !== positionId)
    || orders.some((order) => text(order?.positionId) !== positionId)) return unresolved('BROKER_CLOSE_IDENTITY_MISMATCH');
  const protectiveOrders = orders.filter((order) => order?.closingOrder === true
    && order?.isStopOut !== true
    && ['4', 'STOP_LOSS_TAKE_PROFIT', 'STOP_LOSS/TAKE_PROFIT'].includes(text(order?.orderType).toUpperCase())
    && approx(order?.takeProfit, target, Math.max(tickSize / 2, 1e-9)));
  if (protectiveOrders.length !== orders.length || protectiveOrders.length === 0) return unresolved('BROKER_CLOSE_NOT_CONFIRMED_AS_TP');
  const stop = number(leg?.stopLoss);
  const priceTolerance = Math.max(tickSize * 1.5, 1e-9);
  if (stop != null && Math.abs(target - stop) <= priceTolerance * 2) return unresolved('BROKER_TP_SL_PRICE_AMBIGUOUS');
  if (!deals.every((deal) => {
    const price = number(deal?.executionPrice);
    if (price == null) return false;
    if (stop != null) return Math.abs(price - target) + tickSize < Math.abs(price - stop);
    return approx(price, target, priceTolerance);
  })) return unresolved('BROKER_CLOSE_PRICE_NOT_TP');
  const result = confirmed(snapshot, deals);
  return result || unresolved('BROKER_TP_CLOSE_INCOMPLETE');
}

/** Conservatively classify a broker close as TP only when broker history proves a complete TP exit. */
export function classifyBrokerTpFill({ platform, leg, snapshot } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return unresolved('BROKER_SNAPSHOT_UNAVAILABLE');
  const kind = text(platform).toLowerCase();
  if (kind === 'mt5') return classifyMt5(leg || {}, snapshot);
  if (kind === 'ctrader') return classifyCTrader(leg || {}, snapshot);
  return unresolved('BROKER_PLATFORM_UNSUPPORTED');
}
