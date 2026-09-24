function decimals(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function constraints(instrument = {}) {
  const step = Number(instrument.stepLots ?? 0.01);
  const min = Number(instrument.minLots ?? step);
  const max = Number(instrument.maxLots ?? Number.POSITIVE_INFINITY);
  if (!(step > 0) || !(min > 0) || !(max >= min) || !Number.isFinite(max)) {
    throw new TypeError('finite broker volume constraints required for margin-equivalent sizing');
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
  maxIterations = 64,
} = {}) {
  const budget = Number(marginBudget);
  if (!(budget > 0) || typeof estimateMargin !== 'function') {
    throw new TypeError('positive margin budget and estimator required');
  }

  const { step, minIndex, maxIndex, precision } = constraints(instrument);
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
    const error = new RangeError('broker minimum volume exceeds margin-equivalent budget');
    error.code = 'MARGIN_EQUIVALENT_BELOW_BROKER_MINIMUM';
    error.minimumLots = lotsFor(minIndex);
    error.minimumMargin = minMargin;
    error.marginBudget = budget;
    throw error;
  }

  const maxMargin = await marginFor(maxIndex);
  if (maxMargin <= budget + 1e-9) {
    return { lots: lotsFor(maxIndex), expectedMargin: maxMargin, marginBudget: budget };
  }

  let low = minIndex;
  let high = maxIndex;
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
  return { lots: lotsFor(bestIndex), expectedMargin, marginBudget: budget };
}

export async function buildMarginEquivalentSizing({
  referenceLots,
  referenceInstrument,
  targetInstrument,
  maxMarginPercent = 10,
  accountCapacity,
  estimateReferenceMargin,
  estimateTargetMargin,
} = {}) {
  const percent = Number(maxMarginPercent);
  if (!(percent > 0 && percent <= 100)) throw new TypeError('maxMarginPercent must be between 0 and 100');
  if (typeof estimateReferenceMargin !== 'function' || typeof estimateTargetMargin !== 'function') {
    throw new TypeError('broker margin estimators required');
  }

  const normalizedReferenceLots = normalizeReferenceLots(referenceLots, referenceInstrument);
  const referenceMargin = Number(await estimateReferenceMargin(normalizedReferenceLots));
  if (!(referenceMargin > 0)) throw new Error('reference symbol expected margin unavailable');

  const capacity = Number(accountCapacity);
  const capacityBudget = Number.isFinite(capacity) && capacity > 0 ? capacity * percent / 100 : Number.POSITIVE_INFINITY;
  const marginBudget = Math.min(referenceMargin, capacityBudget);
  if (!(marginBudget > 0)) throw new Error('margin-equivalent budget unavailable');

  const target = await largestLotsWithinMargin({
    instrument: targetInstrument,
    marginBudget,
    estimateMargin: estimateTargetMargin,
  });

  return {
    referenceLots: normalizedReferenceLots,
    referenceMargin,
    maxMarginPercent: percent,
    accountCapacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    marginBudget,
    lots: target.lots,
    expectedMargin: target.expectedMargin,
  };
}
