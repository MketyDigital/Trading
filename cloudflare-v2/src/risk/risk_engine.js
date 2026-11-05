import { allocateVolumeAcrossTargets } from '../execution/position_group.js';

function decimals(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
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

function volumePrecision(step) {
  return decimals(step);
}

function toStepIndex(volume, step, mode) {
  const ratio = volume / step;
  return mode === 'ceil' ? Math.ceil(ratio - 1e-12) : Math.floor(ratio + 1e-12);
}

export function calculateRiskPlan({
  equity, balance, riskPercent, riskAmount, riskBasis = 'EQUITY',
  entry, stopLoss, targetCount = 1, instrument = {},
  minimumLotPolicy = 'FLOOR',
}) {
  if (!Number.isInteger(targetCount) || targetCount < 1) throw new TypeError('targetCount must be >= 1');
  // Risk amount / percentage is per TP leg. Each leg gets its own risk budget.
  const riskPerLeg = resolveRiskAmount({ equity, balance, riskPercent, riskAmount, riskBasis });
  const lossPerLotAtStop = resolveLossPerLot({ entry, stopLoss, instrument });
  const step = Number(instrument.stepLots ?? 0.01);
  const min = Number(instrument.minLots ?? step);
  const max = Number(instrument.maxLots ?? Number.POSITIVE_INFINITY);
  if (!(step > 0) || !(min > 0) || !(max >= min)) throw new TypeError('valid volume constraints required');

  // Broker constraints are expressed in step units to avoid floating-point drift.
  const minIndex = toStepIndex(min, step, 'ceil');
  const maxIndex = Number.isFinite(max) ? toStepIndex(max, step, 'floor') : Number.POSITIVE_INFINITY;
  if (!(maxIndex >= minIndex)) throw new RangeError('broker volume constraints have no executable lot size');

  const rawLotsPerLeg = riskPerLeg / lossPerLotAtStop;
  const rawIndex = toStepIndex(rawLotsPerLeg, step, 'floor');
  const policy = String(minimumLotPolicy || 'FLOOR').trim().toUpperCase();
  let normalizedIndex = rawIndex;
  let minimumFloorApplied = false;
  let maximumCapApplied = false;

  if (normalizedIndex < minIndex) {
    if (policy === 'REJECT') {
      const error = new RangeError('risk-sized volume per leg is below broker minimum');
      error.code = 'RISK_BELOW_BROKER_MINIMUM';
      error.minimumLots = Number((minIndex * step).toFixed(volumePrecision(step)));
      error.requestedLots = rawLotsPerLeg;
      throw error;
    }
    if (policy !== 'FLOOR') throw new TypeError('minimumLotPolicy must be FLOOR or REJECT');
    normalizedIndex = minIndex;
    minimumFloorApplied = true;
  }
  if (normalizedIndex > maxIndex) {
    normalizedIndex = maxIndex;
    maximumCapApplied = true;
  }

  const lotsPerLeg = Number((normalizedIndex * step).toFixed(volumePrecision(step)));
  const totalLots = Number((lotsPerLeg * targetCount).toFixed(volumePrecision(step)));
  const legLots = allocateVolumeAcrossTargets(totalLots, targetCount, step);
  const actualRiskPerLeg = lotsPerLeg * lossPerLotAtStop;
  return {
    riskAmount: Number(riskPerLeg.toFixed(2)),
    riskAmountPerLeg: Number(riskPerLeg.toFixed(2)),
    totalRiskAmount: Number((riskPerLeg * targetCount).toFixed(2)),
    riskBasis: String(riskBasis).toUpperCase(),
    lossPerLotAtStop: Number(lossPerLotAtStop.toFixed(8)),
    rawLotsPerLeg: Number(rawLotsPerLeg.toFixed(8)),
    lotsPerLeg, totalLots, legLots,
    minimumLotPolicy: policy,
    minimumFloorApplied,
    maximumCapApplied,
    estimatedRiskPerLeg: Number(actualRiskPerLeg.toFixed(2)),
    estimatedRisk: Number((actualRiskPerLeg * targetCount).toFixed(2)),
    riskOverBudgetPerLeg: Number(Math.max(0, actualRiskPerLeg - riskPerLeg).toFixed(2)),
  };
}
