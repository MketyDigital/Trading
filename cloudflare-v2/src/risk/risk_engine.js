import { allocateVolumeAcrossTargets } from '../execution/position_group.js';

function decimals(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function clampMax(value, max) {
  return Math.min(max ?? value, value);
}

function resolveRiskAmount({ equity, balance, riskPercent, riskAmount }) {
  if (Number.isFinite(Number(riskAmount)) && Number(riskAmount) > 0) return Number(riskAmount);

  const base = Number.isFinite(Number(equity)) && Number(equity) > 0
    ? Number(equity)
    : Number(balance);
  const percent = Number(riskPercent);

  if (!(base > 0) || !(percent > 0)) {
    throw new TypeError('positive balance/equity and riskPercent or riskAmount required');
  }

  return base * percent / 100;
}

function resolveLossPerLot({ entry, stopLoss, instrument }) {
  // Preferred for instruments/brokers whose P&L formula is not safely modeled
  // by a simple tick-value multiplication. Adapters may obtain this from the
  // platform's own order/profit calculation API.
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
  equity,
  balance,
  riskPercent,
  riskAmount,
  entry,
  stopLoss,
  targetCount = 1,
  instrument = {},
}) {
  const allowedRisk = resolveRiskAmount({ equity, balance, riskPercent, riskAmount });
  const lossPerLotAtStop = resolveLossPerLot({ entry, stopLoss, instrument });

  const step = Number(instrument.stepLots ?? 0.01);
  const min = Number(instrument.minLots ?? step);
  const max = Number(instrument.maxLots ?? Number.POSITIVE_INFINITY);

  if (!(step > 0) || !(min > 0) || !(max >= min)) {
    throw new TypeError('valid volume constraints required');
  }

  // Floor rather than round so normalization never increases intended risk.
  const rawLots = allowedRisk / lossPerLotAtStop;
  const steppedLots = Math.floor(rawLots / step) * step;

  // Never raise a risk-sized order to the broker minimum. If the smallest
  // tradable order would exceed the configured risk, the safe result is no trade.
  if (steppedLots < min) {
    throw new RangeError('risk-sized volume is below broker minimum');
  }

  const totalLots = Number(clampMax(steppedLots, max).toFixed(decimals(step)));
  const actualRisk = totalLots * lossPerLotAtStop;
  const legLots = allocateVolumeAcrossTargets(totalLots, targetCount, step);

  return {
    riskAmount: Number(allowedRisk.toFixed(2)),
    lossPerLotAtStop: Number(lossPerLotAtStop.toFixed(8)),
    totalLots,
    legLots,
    estimatedRisk: Number(actualRisk.toFixed(2)),
  };
}
