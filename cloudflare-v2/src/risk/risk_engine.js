import { allocateVolumeAcrossTargets } from '../execution/position_group.js';

function decimals(step) {
  const text = String(step ?? 0.01).toLowerCase();
  const [coefficient, exponentText] = text.split('e');
  const fractionalDigits = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
  const exponent = exponentText == null ? 0 : Number(exponentText);
  return Math.max(0, fractionalDigits - exponent);
}

function resolveRiskAmount({ equity, balance, riskPercent, riskAmount, riskBasis }) {
  if (Number.isFinite(Number(riskAmount)) && Number(riskAmount) > 0) return Number(riskAmount);
  const basis = String(riskBasis || (equity != null ? 'EQUITY' : 'BALANCE')).trim().toUpperCase();
  const rawBase = basis === 'BALANCE' ? balance : equity;
  const base = Number(rawBase);
  const percent = Number(riskPercent);
  if (!Number.isFinite(base) || !(base > 0) || !Number.isFinite(percent) || !(percent > 0) || percent > 100) {
    throw new TypeError(`positive ${basis.toLowerCase()} and riskPercent between 0 and 100 required`);
  }
  const amount = base * percent / 100;
  if (!Number.isFinite(amount) || !(amount > 0)) throw new TypeError('finite positive risk amount required');
  return amount;
}

function resolveLossPerLot({ entry, stopLoss, instrument }) {
  if (Number.isFinite(Number(instrument?.lossPerLotAtStop)) && Number(instrument.lossPerLotAtStop) > 0) {
    return Number(instrument.lossPerLotAtStop);
  }
  const tickSize = Number(instrument?.tickSize);
  const tickValuePerLot = Number(instrument?.tickValuePerLot);
  const distance = Math.abs(Number(entry) - Number(stopLoss));
  if (![distance, tickSize, tickValuePerLot].every(Number.isFinite)
    || !(distance > 0) || !(tickSize > 0) || !(tickValuePerLot > 0)) {
    throw new Error('reliable instrument loss model is required');
  }
  const lossPerLot = (distance / tickSize) * tickValuePerLot;
  if (!Number.isFinite(lossPerLot) || !(lossPerLot > 0)) {
    throw new Error('reliable instrument loss model is required');
  }
  return lossPerLot;
}

function volumePrecision(step) {
  return decimals(step);
}

function toStepIndex(volume, step, mode) {
  const ratio = volume / step;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(ratio)) * 8;
  return mode === 'ceil' ? Math.ceil(ratio - tolerance) : Math.floor(ratio + tolerance);
}

export function calculateRiskPlan({
  equity, balance, riskPercent, riskAmount, riskBasis,
  entry, stopLoss, targetCount = 1, instrument = {},
  minimumLotPolicy = 'FLOOR',
}) {
  if (!Number.isInteger(targetCount) || targetCount < 1) throw new TypeError('targetCount must be >= 1');
  // Infer the available account basis only when the caller did not select one.
  // Balance-only broker snapshots must not be rejected merely because the
  // public function defaulted to EQUITY; explicit caller choices remain strict.
  const effectiveRiskBasis = String(riskBasis || (equity != null ? 'EQUITY' : 'BALANCE')).trim().toUpperCase();
  // Risk amount / percentage is per TP leg. Each leg gets its own risk budget.
  const riskPerLeg = resolveRiskAmount({ equity, balance, riskPercent, riskAmount, riskBasis: effectiveRiskBasis });
  if (!Number.isFinite(riskPerLeg) || !(riskPerLeg > 0)) throw new TypeError('finite positive per-leg risk budget required');
  const lossPerLotAtStop = resolveLossPerLot({ entry, stopLoss, instrument });
  const step = Number(instrument.stepLots ?? 0.01);
  const min = Number(instrument.minLots ?? step);
  const max = Number(instrument.maxLots ?? Number.POSITIVE_INFINITY);
  if (!Number.isFinite(step) || !(step > 0) || !Number.isFinite(min) || !(min > 0)
    || (!(Number.isFinite(max) || max === Number.POSITIVE_INFINITY)) || !(max >= min)) {
    throw new TypeError('valid volume constraints required');
  }

  // Broker constraints are expressed in step units to avoid floating-point drift.
  const minIndex = toStepIndex(min, step, 'ceil');
  const maxIndex = Number.isFinite(max) ? toStepIndex(max, step, 'floor') : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(minIndex) || (Number.isFinite(max) && !Number.isFinite(maxIndex))
    || !(maxIndex >= minIndex)) throw new RangeError('broker volume constraints have no executable lot size');

  const rawLotsPerLeg = riskPerLeg / lossPerLotAtStop;
  if (!Number.isFinite(rawLotsPerLeg) || !(rawLotsPerLeg > 0)) throw new RangeError('risk-sized lots are not finite and executable');
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
  const totalRiskExact = riskPerLeg * targetCount;
  const estimatedRiskExact = actualRiskPerLeg * targetCount;
  if (!Number.isFinite(actualRiskPerLeg) || !(actualRiskPerLeg > 0)
    || !Number.isFinite(totalRiskExact) || !Number.isFinite(estimatedRiskExact)) {
    throw new RangeError('estimated stop-loss risk is not finite');
  }
  return {
    riskAmount: Number(riskPerLeg.toFixed(2)),
    riskAmountExact: riskPerLeg,
    riskAmountPerLeg: Number(riskPerLeg.toFixed(2)),
    totalRiskAmount: Number(totalRiskExact.toFixed(2)),
    riskBasis: effectiveRiskBasis,
    lossPerLotAtStop: Number(lossPerLotAtStop.toFixed(8)),
    rawLotsPerLeg: Number(rawLotsPerLeg.toFixed(8)),
    lotsPerLeg, totalLots, legLots,
    minimumLotPolicy: policy,
    minimumFloorApplied,
    maximumCapApplied,
    estimatedRiskPerLeg: Number(actualRiskPerLeg.toFixed(2)),
    estimatedRiskPerLegExact: actualRiskPerLeg,
    estimatedRisk: Number(estimatedRiskExact.toFixed(2)),
    estimatedRiskExact,
    riskOverBudgetPerLeg: Number(Math.max(0, actualRiskPerLeg - riskPerLeg).toFixed(2)),
  };
}
