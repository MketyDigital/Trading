import { allocateVolumeAcrossTargets } from '../execution/position_group.js';

function decimals(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function clampMax(value, max) {
  return Math.min(max ?? value, value);
}

function resolveRiskAmount({ equity, balance, riskPercent, riskAmount, riskBasis = 'EQUITY' }) {
  if (Number.isFinite(Number(riskAmount)) && Number(riskAmount) > 0) return Number(riskAmount);
  const basis = String(riskBasis || 'EQUITY').trim().toUpperCase();
  const rawBase = basis === 'BALANCE' ? balance : equity;
  const base = Number(rawBase);
  const percent = Number(riskPercent);
  if (!(base > 0) || !(percent > 0) || percent > 100) {
    throw new TypeError(`positive ${basis.toLowerCase()} and riskPercent between 0 and 100 required`);
  }
  return base * percent / 100;
}

function resolveLossPerLot({ entry, stopLoss, instrument }) {
  if (Number.isFinite(Number(instrument?.lossPerLotAtStop)) && Number(instrument.lossPerLotAtStop) > 0) {
    return Number(instrument.lossPerLotAtStop);
  }
  const tickSize = Number(instrument?.tickSize);
  const tickValuePerLot = Number(instrument?.tickValuePerLot);
  const distance = Math.abs(Number(entry) - Number(stopLoss));
  if (!(distance > 0) || !(tickSize > 0) || !(tickValuePerLot > 0)) {
    throw new Error('reliable instrument loss model is required');
  }
  return (distance / tickSize) * tickValuePerLot;
}

export function calculateRiskPlan({
  equity, balance, riskPercent, riskAmount, riskBasis = 'EQUITY',
  entry, stopLoss, targetCount = 1, instrument = {},
}) {
  if (!Number.isInteger(targetCount) || targetCount < 1) throw new TypeError('targetCount must be >= 1');
  // Risk amount / percentage is per TP leg. Each leg gets its own risk budget.
  const riskPerLeg = resolveRiskAmount({ equity, balance, riskPercent, riskAmount, riskBasis });
  const lossPerLotAtStop = resolveLossPerLot({ entry, stopLoss, instrument });
  const step = Number(instrument.stepLots ?? 0.01);
  const min = Number(instrument.minLots ?? step);
  const max = Number(instrument.maxLots ?? Number.POSITIVE_INFINITY);
  if (!(step > 0) || !(min > 0) || !(max >= min)) throw new TypeError('valid volume constraints required');
  const rawLotsPerLeg = riskPerLeg / lossPerLotAtStop;
  const steppedLotsPerLeg = Math.floor((rawLotsPerLeg / step) + 1e-12) * step;
  const maximumSteppedLots = Number.isFinite(max)
    ? Math.floor((max / step) + 1e-12) * step
    : Number.POSITIVE_INFINITY;
  if (!(maximumSteppedLots >= min)) throw new RangeError('broker volume constraints have no executable lot size');
  if (steppedLotsPerLeg < min) throw new RangeError('risk-sized volume per leg is below broker minimum');
  const lotsPerLeg = Number(Math.min(steppedLotsPerLeg, maximumSteppedLots).toFixed(decimals(step)));
  const totalLots = Number((lotsPerLeg * targetCount).toFixed(decimals(step)));
  const legLots = allocateVolumeAcrossTargets(totalLots, targetCount, step);
  const actualRiskPerLeg = lotsPerLeg * lossPerLotAtStop;
  return {
    riskAmount: Number(riskPerLeg.toFixed(2)),
    riskAmountPerLeg: Number(riskPerLeg.toFixed(2)),
    totalRiskAmount: Number((riskPerLeg * targetCount).toFixed(2)),
    riskBasis: String(riskBasis).toUpperCase(),
    lossPerLotAtStop: Number(lossPerLotAtStop.toFixed(8)),
    lotsPerLeg, totalLots, legLots,
    estimatedRiskPerLeg: Number(actualRiskPerLeg.toFixed(2)),
    estimatedRisk: Number((actualRiskPerLeg * targetCount).toFixed(2)),
  };
}
