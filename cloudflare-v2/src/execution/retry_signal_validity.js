function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function evaluateRetrySignalValidity(action = {}, marketPrice = null) {
  if (String(action?.type || '').toUpperCase() !== 'OPEN_POSITION') {
    return { allowed: true, reason: 'NOT_OPEN_POSITION' };
  }

  const side = String(action?.side || '').trim().toUpperCase();
  if (!['BUY', 'SELL'].includes(side)) {
    return { allowed: false, code: 'RETRY_SIGNAL_SIDE_INVALID' };
  }

  const stopLoss = finitePositive(action?.stopLoss);
  const takeProfit = finitePositive(action?.takeProfit);
  if (stopLoss == null && takeProfit == null) {
    return { allowed: true, reason: 'NO_PROTECTION_BOUNDARY' };
  }

  const price = finitePositive(marketPrice);
  if (price == null) {
    return { allowed: false, code: 'RETRY_MARKET_PRICE_UNAVAILABLE', retryable: true };
  }

  if (side === 'BUY') {
    if (stopLoss != null && price <= stopLoss) {
      return { allowed: false, code: 'RETRY_SIGNAL_STOP_ALREADY_CROSSED', marketPrice: price };
    }
    if (takeProfit != null && price >= takeProfit) {
      return { allowed: false, code: 'RETRY_SIGNAL_TARGET_ALREADY_CROSSED', marketPrice: price };
    }
  } else {
    if (stopLoss != null && price >= stopLoss) {
      return { allowed: false, code: 'RETRY_SIGNAL_STOP_ALREADY_CROSSED', marketPrice: price };
    }
    if (takeProfit != null && price <= takeProfit) {
      return { allowed: false, code: 'RETRY_SIGNAL_TARGET_ALREADY_CROSSED', marketPrice: price };
    }
  }

  return { allowed: true, marketPrice: price };
}
