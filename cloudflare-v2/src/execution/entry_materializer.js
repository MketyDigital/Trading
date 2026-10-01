function chooseRangePrice(entry, mode) {
  if (mode === 'LOWER') return Number(entry.min);
  if (mode === 'UPPER') return Number(entry.max);
  if (mode === 'MIDPOINT') return (Number(entry.min) + Number(entry.max)) / 2;
  throw new TypeError(`unsupported range mode: ${mode}`);
}

export function materializeExecutionEntry(intent, { currentPrice, rangeMode = 'MARKET_IF_IN_RANGE' } = {}) {
  const entry = intent?.entry;
  if (!entry) throw new TypeError('entry required');

  if (entry.kind === 'PRICE') {
    return { orderType: intent.orderType, entry: { kind: 'PRICE', value: Number(entry.value) } };
  }

  if (entry.kind === 'MARKET') {
    return {
      orderType: 'MARKET',
      entry: Number.isFinite(Number(currentPrice))
        ? { kind: 'MARKET', referencePrice: Number(currentPrice) }
        : { kind: 'MARKET' },
    };
  }

  if (entry.kind !== 'RANGE') throw new TypeError(`unsupported entry kind: ${entry.kind}`);

  const min = Number(entry.min);
  const max = Number(entry.max);
  if (!(Number.isFinite(min) && Number.isFinite(max) && min <= max)) throw new TypeError('valid entry range required');

  const declaredOrderType = String(intent.orderType || 'MARKET').toUpperCase();

  // A reference entry/range on an immediate MARKET signal must never silently
  // become a LIMIT/STOP order because of the current quote. Pending semantics
  // are authoritative only when the interpreted/raw signal explicitly declared
  // a pending order type.
  if (declaredOrderType === 'MARKET') {
    const market = Number(currentPrice);
    return {
      orderType: 'MARKET',
      entry: Number.isFinite(market)
        ? { kind: 'MARKET', referencePrice: market }
        : { kind: 'MARKET' },
    };
  }

  if (!['LIMIT', 'STOP', 'STOP_LIMIT'].includes(declaredOrderType)) {
    throw new TypeError(`unsupported order type for entry range: ${declaredOrderType}`);
  }

  const market = Number(currentPrice);
  const mode = String(rangeMode).toUpperCase();
  let price;
  if (mode === 'LOWER' || mode === 'UPPER' || mode === 'MIDPOINT') {
    price = chooseRangePrice(entry, mode);
  } else if (Number.isFinite(market)) {
    // For an explicitly pending order, choose a deterministic boundary but
    // preserve the declared pending type. Do not infer a different one.
    price = market > max ? max : market < min ? min : (min + max) / 2;
  } else {
    price = (min + max) / 2;
  }

  return { orderType: declaredOrderType, entry: { kind: 'PRICE', value: price } };
}
