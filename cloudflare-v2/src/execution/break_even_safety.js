function finitePositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function isBreakEvenAction(action = {}) {
  return String(action?.managementType || '').trim().toUpperCase() === 'MOVE_SL_TO_BE';
}

export function evaluateBreakEvenEligibility({ side, entryPrice, marketPrice } = {}) {
  const normalizedSide = String(side || '').trim().toUpperCase();
  const entry = finitePositive(entryPrice);
  const market = finitePositive(marketPrice);

  if (!['BUY', 'SELL'].includes(normalizedSide) || entry == null || market == null) {
    return {
      allowed: false,
      reason: 'BREAK_EVEN_CONTEXT_UNAVAILABLE',
      side: normalizedSide || null,
      entryPrice: entry,
      marketPrice: market,
    };
  }

  const allowed = normalizedSide === 'BUY' ? market > entry : market < entry;
  return {
    allowed,
    ...(allowed ? {} : { reason: 'BREAK_EVEN_NOT_ELIGIBLE_YET' }),
    side: normalizedSide,
    entryPrice: entry,
    marketPrice: market,
  };
}
