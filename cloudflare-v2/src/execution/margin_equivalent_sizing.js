function decimals(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function constraints(instrument = {}) {
  const step = Number(instrument.stepLots ?? 0.01);
  const min = Number(instrument.minLots ?? step);
  const max = Number(instrument.maxLots ?? Number.POSITIVE_INFINITY);
  if (!(step > 0) || !(min > 0) || !(max >= min) || !Number.isFinite(max)) {
    throw new TypeError('finite broker volume constraints required for broker-aware sizing');
  }
  const minIndex = Math.ceil((min / step) - 1e-12);
  const maxIndex = Math.floor((max / step) + 1e-12);
  if (maxIndex < minIndex) throw new RangeError('broker volume constraints have no executable lot size');
  return { step, minIndex, maxIndex, precision: decimals(step) };
}

export function normalizeReferenceLots(value, instrument = {}) {
  const wanted = Number(value);
  if (!(wanted > 0)) throw new TypeError('positive reference lots required');
  const { step, minIndex, maxIndex, precision } = constraints(instrument);
  const wantedIndex = Math.floor((wanted / step) + 1e-12);
  const index = Math.min(Math.max(wantedIndex, minIndex), maxIndex);
  return Number((index * step).toFixed(precision));
}

export async function largestLotsWithinMargin({
  instrument = {},
  marginBudget,
  estimateMargin,
  maximumLots,
  allowBrokerMinimumFloor = false,
  belowMinimumCode = 'SIZING_BELOW_BROKER_MINIMUM',
  maxIterations = 64,
} = {}) {
  const budget = Number(marginBudget);
  if (!(budget > 0) || typeof estimateMargin !== 'function') {
    throw new TypeError('positive margin budget and estimator required');
  }

  const { step, minIndex, maxIndex, precision } = constraints(instrument);
  const normalizedMaximum = normalizeReferenceLots(maximumLots ?? instrument.maxLots, instrument);
  const capIndex = Math.min(maxIndex, Math.max(minIndex, Math.floor((normalizedMaximum / step) + 1e-12)));
  const lotsFor = (index) => Number((index * step).toFixed(precision));
  const checked = new Map();

  async function marginFor(index) {
    if (checked.has(index)) return checked.get(index);
    const lots = lotsFor(index);
    const margin = Number(await estimateMargin(lots));
    if (!(Number.isFinite(margin) && margin >= 0)) throw new Error('broker expected margin unavailable');
    checked.set(index, margin);
    return margin;
  }

  const minMargin = await marginFor(minIndex);
  if (minMargin > budget + 1e-9) {
    if (allowBrokerMinimumFloor) {
      return {
        lots: lotsFor(minIndex),
        expectedMargin: minMargin,
        marginBudget: budget,
        minimumFloorApplied: true,
        exceededBudget: true,
      };
    }
    const error = new RangeError('broker minimum volume exceeds configured sizing budget');
    error.code = belowMinimumCode;
    error.minimumLots = lotsFor(minIndex);
    error.minimumMargin = minMargin;
    error.marginBudget = budget;
    throw error;
  }

  const capMargin = await marginFor(capIndex);
  if (capMargin <= budget + 1e-9) {
    return {
      lots: lotsFor(capIndex),
      expectedMargin: capMargin,
      marginBudget: budget,
      minimumFloorApplied: false,
      exceededBudget: false,
    };
  }

  let low = minIndex;
  let high = capIndex;
  let bestIndex = minIndex;
  let iterations = 0;
  while (low <= high && iterations < maxIterations) {
    iterations += 1;
    const mid = Math.floor((low + high) / 2);
    const margin = await marginFor(mid);
    if (margin <= budget + 1e-9) {
      bestIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const expectedMargin = await marginFor(bestIndex);
  return {
    lots: lotsFor(bestIndex),
    expectedMargin,
    marginBudget: budget,
    minimumFloorApplied: false,
    exceededBudget: false,
  };
}

export async function buildSymbolEquivalentSizing({
  referenceLots,
  referenceInstrument,
  targetInstrument,
  estimateReferenceMargin,
  estimateTargetMargin,
} = {}) {
  if (typeof estimateReferenceMargin !== 'function' || typeof estimateTargetMargin !== 'function') {
    throw new TypeError('broker margin estimators required');
  }

  const normalizedReferenceLots = normalizeReferenceLots(referenceLots, referenceInstrument);
  const referenceMargin = Number(await estimateReferenceMargin(normalizedReferenceLots));
  if (!(referenceMargin > 0)) throw new Error('reference symbol expected margin unavailable');

  // The owner's chosen lot is a ceiling/reference, not a target to maximize.
  // Target products may be reduced when the same lot is heavier, but are never
  // increased above the chosen lot merely because their margin is cheaper.
  // The only upward exception is an unavoidable broker minimum.
  const targetRequestedLots = normalizeReferenceLots(referenceLots, targetInstrument);
  const targetRequestedMargin = Number(await estimateTargetMargin(targetRequestedLots));
  if (!(Number.isFinite(targetRequestedMargin) && targetRequestedMargin >= 0)) {
    throw new Error('target symbol expected margin unavailable');
  }

  if (targetRequestedMargin <= referenceMargin + 1e-9) {
    return {
      referenceLots: normalizedReferenceLots,
      referenceMargin,
      requestedLots: targetRequestedLots,
      lots: targetRequestedLots,
      expectedMargin: targetRequestedMargin,
      marginBudget: referenceMargin,
      minimumFloorApplied: targetRequestedLots > Number(referenceLots) + 1e-12,
      reduced: false,
    };
  }

  const target = await largestLotsWithinMargin({
    instrument: targetInstrument,
    marginBudget: referenceMargin,
    estimateMargin: estimateTargetMargin,
    maximumLots: targetRequestedLots,
    allowBrokerMinimumFloor: true,
    belowMinimumCode: 'SYMBOL_EQUIVALENT_BELOW_BROKER_MINIMUM',
  });

  return {
    referenceLots: normalizedReferenceLots,
    referenceMargin,
    requestedLots: targetRequestedLots,
    lots: target.lots,
    expectedMargin: target.expectedMargin,
    marginBudget: referenceMargin,
    minimumFloorApplied: target.minimumFloorApplied === true,
    reduced: target.lots < targetRequestedLots - 1e-12,
  };
}

export async function buildBalancePercentSizing({
  maximumLots,
  percent,
  accountBalance,
  targetInstrument,
  estimateTargetMargin,
} = {}) {
  const balance = Number(accountBalance);
  const scale = Number(percent);
  if (!(balance > 0)) throw new TypeError('positive broker account balance required');
  if (!(scale > 0 && scale <= 100)) throw new TypeError('balance percent must be between 0 and 100');
  if (typeof estimateTargetMargin !== 'function') throw new TypeError('broker margin estimator required');

  const marginBudget = balance * scale / 100;
  const targetRequestedLots = normalizeReferenceLots(maximumLots, targetInstrument);
  const targetRequestedMargin = Number(await estimateTargetMargin(targetRequestedLots));
  if (!(Number.isFinite(targetRequestedMargin) && targetRequestedMargin >= 0)) {
    throw new Error('target symbol expected margin unavailable');
  }

  if (targetRequestedMargin <= marginBudget + 1e-9) {
    return {
      percent: scale,
      accountBalance: balance,
      marginBudget,
      requestedLots: targetRequestedLots,
      lots: targetRequestedLots,
      expectedMargin: targetRequestedMargin,
      reduced: false,
    };
  }

  const target = await largestLotsWithinMargin({
    instrument: targetInstrument,
    marginBudget,
    estimateMargin: estimateTargetMargin,
    maximumLots: targetRequestedLots,
    allowBrokerMinimumFloor: false,
    belowMinimumCode: 'BALANCE_PERCENT_BELOW_BROKER_MINIMUM',
  });

  return {
    percent: scale,
    accountBalance: balance,
    marginBudget,
    requestedLots: targetRequestedLots,
    lots: target.lots,
    expectedMargin: target.expectedMargin,
    reduced: target.lots < targetRequestedLots - 1e-12,
  };
}
