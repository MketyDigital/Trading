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
    const maxRiskPercent = Number(policy.maxRiskPercent);
    const requestedFloorOverage = Number(request.minimumVolumeRiskOveragePercent ?? 0);
    const minimumFloorOverage = Number.isFinite(requestedFloorOverage) && requestedFloorOverage >= 0
      ? requestedFloorOverage
      : Number.POSITIVE_INFINITY;
    // Keep the broker-minimum exception deliberately small. This is an
    // independent cap on the amount above the requested per-leg risk budget,
    // not merely headroom against maxRiskPercent.
    const configuredFloorTolerance = Number(policy.minimumVolumeRiskTolerancePercent ?? 0.05);
    const floorTolerance = Number.isFinite(configuredFloorTolerance) && configuredFloorTolerance >= 0
      ? configuredFloorTolerance
      : 0;
    if (minimumFloorOverage > floorTolerance) reasons.push('MINIMUM_VOLUME_RISK_TOLERANCE_EXCEEDED');
    const permittedRisk = maxRiskPercent + Math.min(minimumFloorOverage, floorTolerance);
    if (Number.isFinite(maxRiskPercent) && Number(request.riskPercent) > permittedRisk) reasons.push('MAX_RISK_EXCEEDED');

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
