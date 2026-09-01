function inferPendingType(side, entryPrice, currentPrice) {
  if (side === 'BUY') return entryPrice < currentPrice ? 'LIMIT' : 'STOP';
  if (side === 'SELL') return entryPrice > currentPrice ? 'LIMIT' : 'STOP';
  throw new TypeError('BUY or SELL side required');
}

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
  if (!Number.isFinite(Number(currentPrice))) throw new Error('current price is required to execute an entry range');

  const market = Number(currentPrice);
  const min = Number(entry.min);
  const max = Number(entry.max);
  if (!(Number.isFinite(min) && Number.isFinite(max) && min <= max)) throw new TypeError('valid entry range required');

  const mode = String(rangeMode).toUpperCase();
  if (mode === 'MARKET_ALWAYS') {
    return { orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: market } };
  }

  if (mode === 'MARKET_IF_IN_RANGE') {
    if (market >= min && market <= max) {
      return { orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: market } };
    }
    const price = market > max ? max : min;
    return { orderType: inferPendingType(intent.side, price, market), entry: { kind: 'PRICE', value: price } };
  }

  const price = chooseRangePrice(entry, mode);
  return { orderType: inferPendingType(intent.side, price, market), entry: { kind: 'PRICE', value: price } };
}
