const SYMBOL_ALIASES = new Map([
  // Metals
  ['GOLD', 'XAUUSD'],
  ['XAU', 'XAUUSD'],
  ['XAUUSD', 'XAUUSD'],
  ['SILVER', 'XAGUSD'],
  ['XAG', 'XAGUSD'],
  ['XAGUSD', 'XAGUSD'],

  // US indices
  ['DJ30', 'US30'],
  ['DJI', 'US30'],
  ['DOW', 'US30'],
  ['DOWJONES', 'US30'],
  ['US30', 'US30'],
  ['USTEC', 'NAS100'],
  ['US100', 'NAS100'],
  ['NASDAQ', 'NAS100'],
  ['NASDAQ100', 'NAS100'],
  ['NAS100', 'NAS100'],
  ['SPX500', 'US500'],
  ['SP500', 'US500'],
  ['S&P500', 'US500'],
  ['US500', 'US500'],

  // European / Asian indices
  ['DAX', 'GER40'],
  ['DAX40', 'GER40'],
  ['GER40', 'GER40'],
  ['FTSE', 'UK100'],
  ['FTSE100', 'UK100'],
  ['UK100', 'UK100'],
  ['NIKKEI', 'JP225'],
  ['NIKKEI225', 'JP225'],
  ['JP225', 'JP225'],
  ['HANGSENG', 'HK50'],
  ['HSI', 'HK50'],
  ['HK50', 'HK50'],

  // Energy
  ['WTI', 'USOIL'],
  ['WTICRUDE', 'USOIL'],
  ['CRUDEOIL', 'USOIL'],
  ['USOIL', 'USOIL'],
  ['BRENT', 'UKOIL'],
  ['BRENTCRUDE', 'UKOIL'],
  ['UKOIL', 'UKOIL'],

  // Crypto common shorthand. Quote currency remains explicit in canonical form.
  ['BITCOIN', 'BTCUSD'],
  ['BTC', 'BTCUSD'],
  ['BTCUSD', 'BTCUSD'],
  ['ETHEREUM', 'ETHUSD'],
  ['ETHER', 'ETHUSD'],
  ['ETH', 'ETHUSD'],
  ['ETHUSD', 'ETHUSD'],
]);

function cleanSymbol(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+INDEX$/i, '')
    .replace(/[()]/g, '')
    .replace(/[\s\/_-]+/g, '')
    .replace(/\.(?:M|PRO|RAW|ECN|A|B|C)$/i, '')
    .replace(/(?:PRO|RAW|ECN)$/i, '');
}

export function normalizeSymbol(value, registry = SYMBOL_ALIASES) {
  const source = String(value ?? '').trim();
  const cleaned = cleanSymbol(source);
  const volMatch = cleaned.match(/^VOLATILITY(10|15|25|30|50|75|90|100)(1S)?$/);
  if (volMatch) {
    return { canonical: `DERIV:VOLATILITY_${volMatch[1]}${volMatch[2] ? '_1S' : ''}`, source };
  }
  return { canonical: registry.get(cleaned) || cleaned, source };
}

/**
 * Produces a comparison key only. It is deliberately conservative: execution
 * must resolve against a connected platform's symbol catalog instead of using
 * fuzzy edit-distance guessing for money-moving actions.
 */
export function normalizeInstrumentKey(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\b(?:INDEX|CASH|SPOT|FUTURES?|CFD)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Resolves a human/canonical symbol to the actual symbol exposed by a broker
 * or platform account. Catalog entries should be populated dynamically from
 * MT5 symbols_get/symbol_info, cTrader symbol lists/details, Deriv
 * active_symbols/contracts_for, or an equivalent adapter.
 *
 * Never guesses when more than one platform symbol is a valid match.
 */
export function resolveSymbolAgainstCatalog(value, catalog = []) {
  const requestedCanonical = normalizeSymbol(value).canonical;
  const requestedKeys = new Set([
    normalizeInstrumentKey(value),
    normalizeInstrumentKey(requestedCanonical),
  ].filter(Boolean));

  const matches = [];
  for (const item of catalog) {
    if (!item?.platformSymbol) continue;

    const itemKeys = new Set([
      normalizeInstrumentKey(item.platformSymbol),
      normalizeInstrumentKey(item.canonical),
      ...(item.aliases || []).map(normalizeInstrumentKey),
    ].filter(Boolean));

    const itemCanonical = item.canonical ? normalizeSymbol(item.canonical).canonical : null;
    const sameCanonical = Boolean(itemCanonical && itemCanonical === requestedCanonical);
    const exactKeyMatch = [...requestedKeys].some((key) => itemKeys.has(key));

    if (sameCanonical || exactKeyMatch) matches.push(item);
  }

  if (matches.length === 1) {
    return { ok: true, ...matches[0], requestedCanonical };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'AMBIGUOUS_SYMBOL',
      requestedCanonical,
      candidates: matches.map((item) => item.platformSymbol),
    };
  }

  return { ok: false, reason: 'SYMBOL_NOT_FOUND', requestedCanonical, candidates: [] };
}

export function normalizeOrderIntent(value) {
  const text = String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  const side = text.includes('SELL') ? 'SELL' : text.includes('BUY') ? 'BUY' : null;
  let orderType = 'MARKET';
  if (text.includes('STOP LIMIT')) orderType = 'STOP_LIMIT';
  else if (text.includes('LIMIT')) orderType = 'LIMIT';
  else if (text.includes('STOP')) orderType = 'STOP';
  return { side, orderType };
}

function decimalPlaces(step) {
  const text = String(step);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

function clamp(value, min, max) {
  return Math.min(max ?? value, Math.max(min ?? value, value));
}

export function normalizePrice(value, { digits, tickSize } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError('price must be finite');
  let normalized = numeric;
  if (tickSize) normalized = Math.round(normalized / tickSize) * tickSize;
  const places = Number.isInteger(digits) ? digits : decimalPlaces(tickSize || 1);
  return Number(normalized.toFixed(places));
}

export function normalizeVolumeForMT5(lots, { min = 0.01, max = Number.POSITIVE_INFINITY, step = 0.01 } = {}) {
  const numeric = Number(lots);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new TypeError('lots must be positive');
  const stepped = Math.round(numeric / step) * step;
  return Number(clamp(stepped, min, max).toFixed(decimalPlaces(step)));
}

export function normalizeVolumeForCTrader(lots, { lotSize, minVolume = 1, maxVolume = Number.POSITIVE_INFINITY, stepVolume = 1 } = {}) {
  const numericLots = Number(lots);
  const unitsPerLot = Number(lotSize);
  if (!Number.isFinite(numericLots) || numericLots <= 0) throw new TypeError('lots must be positive');
  if (!Number.isFinite(unitsPerLot) || unitsPerLot <= 0) throw new TypeError('lotSize is required');
  const protocolVolume = numericLots * unitsPerLot * 100;
  const stepped = Math.round(protocolVolume / stepVolume) * stepVolume;
  return Math.trunc(clamp(stepped, minVolume, maxVolume));
}
