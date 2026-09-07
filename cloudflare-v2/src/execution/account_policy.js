export function evaluateAccountPolicy(policy = {}, request = {}) {
  const reasons = [];
  const actionKind = request.actionKind || 'INCREASE_RISK';

  if (policy.enabled === false) reasons.push('ACCOUNT_DISABLED');
  if (policy.killSwitch === true) reasons.push('KILL_SWITCH');

  // Risk-reducing actions such as close/partial close/protective SL changes should
  // remain available during drawdown locks unless the explicit kill switch is on.
  const reducingRisk = actionKind === 'REDUCE_RISK';
  if (!reducingRisk) {
    const allowedSymbols = Array.isArray(policy.allowedSymbols) ? policy.allowedSymbols : [];
    if (allowedSymbols.length && !allowedSymbols.includes(String(request.symbol || '').toUpperCase())) reasons.push('SYMBOL_NOT_ALLOWED');

    if (Number.isFinite(Number(policy.maxLotsPerTrade)) && Number(request.totalLots) > Number(policy.maxLotsPerTrade)) reasons.push('MAX_LOTS_EXCEEDED');
    if (Number.isFinite(Number(policy.maxRiskPercent)) && Number(request.riskPercent) > Number(policy.maxRiskPercent)) reasons.push('MAX_RISK_EXCEEDED');

    const dailyLossLimit = Number(policy.maxDailyLossPercent);
    const dailyPnl = Number(request.currentDailyPnlPercent);
    if (Number.isFinite(dailyLossLimit) && dailyLossLimit > 0 && Number.isFinite(dailyPnl) && dailyPnl <= -dailyLossLimit) reasons.push('DAILY_LOSS_LIMIT');

    const maxOpenRisk = Number(policy.maxOpenRiskPercent);
    const currentOpenRisk = Number(request.currentOpenRiskPercent || 0);
    const newRisk = Number(request.riskPercent || 0);
    if (Number.isFinite(maxOpenRisk) && maxOpenRisk > 0 && currentOpenRisk + newRisk > maxOpenRisk) reasons.push('OPEN_RISK_LIMIT');
  }

  return { allowed: reasons.length === 0, reasons };
}
