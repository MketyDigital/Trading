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

function normalizedProtection(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '' || Number(value) === 0) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function protectionEqual(left, right) {
  const a = normalizedProtection(left); const b = normalizedProtection(right);
  if (a === undefined || b === undefined) return false;
  return a === null && b === null
    ? true
    : a != null && b != null && Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-10, Math.abs(b) * 1e-10);
}

/**
 * Compare an exact open-position snapshot with the authoritative leg state.
 * This is deliberately read-only: it produces a management intent for the
 * existing orchestration path and never treats a missing/invalid field as a
 * request to remove protection.
 */
export function classifyBrokerProtectionChange({ platform, leg, snapshot } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.isOpen !== true) return unresolved('BROKER_POSITION_NOT_OPEN');
  const positionId = text(leg?.brokerPositionId);
  if (!positionId || text(snapshot.positionId) !== positionId) return unresolved('BROKER_POSITION_IDENTITY_MISMATCH');
  if (snapshot.symbol != null && text(snapshot.symbol) && leg?.symbol != null
    && text(snapshot.symbol).toUpperCase() !== text(leg.symbol).toUpperCase()) return unresolved('BROKER_SYMBOL_IDENTITY_MISMATCH');
  if (snapshot.side != null && text(snapshot.side) && leg?.side != null
    && text(snapshot.side).toUpperCase() !== text(leg.side).toUpperCase()) return unresolved('BROKER_SIDE_IDENTITY_MISMATCH');

  const brokerStop = normalizedProtection(snapshot.stopLoss !== undefined ? snapshot.stopLoss : snapshot.sl);
  const brokerTarget = normalizedProtection(snapshot.takeProfit !== undefined ? snapshot.takeProfit : snapshot.tp);
  const expectedStop = normalizedProtection(leg?.stopLoss);
  const expectedTarget = normalizedProtection(leg?.takeProfit);
  // Invalid/missing one-sided protection is not evidence of a manual edit.
  // The other valid side can still be mirrored independently; this prevents
  // a malformed TP from blocking a confirmed SL update (and vice versa).
  const slComparable = brokerStop !== undefined && expectedStop !== undefined;
  const tpComparable = brokerTarget !== undefined && expectedTarget !== undefined;
  if (!slComparable && !tpComparable) return unresolved('BROKER_PROTECTION_VALUE_INVALID');
  const slMissing = slComparable && brokerStop == null && expectedStop != null;
  const tpMissing = tpComparable && brokerTarget == null && expectedTarget != null;
  const slChanged = slComparable && !protectionEqual(brokerStop, expectedStop);
  const tpChanged = tpComparable && !protectionEqual(brokerTarget, expectedTarget);
  if (!slChanged && !tpChanged && (slComparable || tpComparable)) return {
    status: 'NO_CHANGE', positionId,
    fingerprint: [positionId,
      brokerStop === undefined ? 'unknown' : brokerStop === null ? 'none' : brokerStop,
      brokerTarget === undefined ? 'unknown' : brokerTarget === null ? 'none' : brokerTarget,
    ].join('|'),
  };
  if (!slChanged && !tpChanged) return unresolved('BROKER_PROTECTION_VALUE_INVALID');

  const actions = [];
  const targetIndex = Number.isInteger(Number(leg?.targetIndex)) ? Number(leg.targetIndex) : undefined;
  if (slChanged) actions.push(slMissing
    ? { type: 'MOVE_SL', stopLoss: expectedStop, ...(targetIndex ? { targetIndex } : {}) }
    : brokerStop == null
    ? { type: 'REMOVE_SL', ...(targetIndex ? { targetIndex } : {}) }
    : { type: 'MOVE_SL', stopLoss: brokerStop, ...(targetIndex ? { targetIndex } : {}) });
  if (tpChanged) actions.push(tpMissing
    ? { type: 'CHANGE_TP', takeProfit: expectedTarget, ...(targetIndex ? { targetIndex } : {}) }
    : brokerTarget == null
    ? { type: 'REMOVE_TP', ...(targetIndex ? { targetIndex } : {}) }
    : { type: 'CHANGE_TP', takeProfit: brokerTarget, ...(targetIndex ? { targetIndex } : {}) });
  return {
    status: 'PROTECTION_CHANGED', positionId, platform: text(platform).toLowerCase(),
    // A broker snapshot that has lost protection is repaired from the valid,
    // persisted requested value. A changed non-null broker value remains the
    // authority for manual edits and is mirrored through the management path.
    stopLoss: slMissing ? expectedStop : brokerStop,
    takeProfit: tpMissing ? expectedTarget : brokerTarget,
    actions,
    fingerprint: [positionId,
      brokerStop === undefined ? 'unknown' : brokerStop === null ? 'none' : brokerStop,
      brokerTarget === undefined ? 'unknown' : brokerTarget === null ? 'none' : brokerTarget,
    ].join('|'),
  };
}

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

function activityKind(deals = []) {
  const reasons = new Set(deals.map((deal) => text(deal?.reason).toUpperCase()).filter(Boolean));
  if (reasons.size > 0 && [...reasons].every((reason) => ['TP', 'TAKE_PROFIT', '5'].includes(reason))) return 'TAKE_PROFIT';
  if (reasons.size > 0 && [...reasons].every((reason) => ['SL', 'STOP_LOSS', '4'].includes(reason))) return 'STOP_LOSS';
  return 'MANUAL';
}

/** Classify exact broker close history for follower/manual lifecycle observation. */
export function classifyBrokerPositionActivity({ platform, leg, snapshot } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return unresolved('BROKER_SNAPSHOT_UNAVAILABLE');
  const positionId = text(leg?.brokerPositionId);
  if (!positionId || text(snapshot.positionId) !== positionId || !Array.isArray(snapshot.deals) || !snapshot.deals.length) return unresolved('BROKER_POSITION_IDENTITY_MISMATCH');
  const deals = snapshot.deals.filter((deal) => text(deal?.positionId) === positionId);
  if (deals.length !== snapshot.deals.length) return unresolved('BROKER_DEAL_IDENTITY_MISMATCH');
  const ids = deals.map((deal) => text(deal?.dealId)).filter(Boolean);
  if (ids.length !== deals.length || new Set(ids).size !== ids.length) return unresolved('BROKER_DEAL_IDENTITY_UNCERTAIN');
  const closedLots = number(snapshot.closedLots) ?? deals.reduce((sum, deal) => sum + (number(deal?.lots) ?? 0), 0);
  if (!(closedLots > 0)) return unresolved('BROKER_CLOSE_NOT_OBSERVED');
  const initialLots = number(snapshot.initialLots);
  const complete = snapshot.isOpen === false && initialLots != null && approx(closedLots, initialLots);
  const kind = activityKind(deals);
  return {
    status: 'ACTIVITY_CONFIRMED',
    positionId,
    dealIds: ids.sort(),
    kind: complete ? kind : `PARTIAL_${kind}`,
    closedLots,
    initialLots,
    platform: text(platform).toLowerCase(),
  };
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
    && (number(order?.takeProfit) == null || approx(order?.takeProfit, target, Math.max(tickSize / 2, 1e-9))));
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
