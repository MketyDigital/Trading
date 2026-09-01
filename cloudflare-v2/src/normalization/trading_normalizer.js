const SYMBOL_ALIASES = new Map([
  ['GOLD', 'XAUUSD'],
  ['XAUUSD', 'XAUUSD'],
  ['SILVER', 'XAGUSD'],
  ['XAGUSD', 'XAGUSD'],
  ['DJ30', 'US30'],
  ['DJI', 'US30'],
  ['DOW', 'US30'],
  ['US30', 'US30'],
  ['USTEC', 'NAS100'],
  ['NASDAQ', 'NAS100'],
  ['NASDAQ100', 'NAS100'],
  ['NAS100', 'NAS100'],
  ['DAX40', 'GER40'],
  ['GER40', 'GER40'],
]);

function cleanSymbol(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+INDEX$/i, '')
    .replace(/[\s\/_-]+/g, '')
    .replace(/\.(?:M|PRO|RAW|ECN|A|B|C)$/i, '')
    .replace(/(?:PRO|RAW|ECN)$/i, '');
}

export function normalizeSymbol(value, registry = SYMBOL_ALIASES) {
  const source = String(value ?? '').trim();
  const cleaned = cleanSymbol(source);
  const volMatch = cleaned.match(/^VOLATILITY(10|25|50|75|100)(1S)?$/);
  if (volMatch) {
    return { canonical: `DERIV:VOLATILITY_${volMatch[1]}${volMatch[2] ? '_1S' : ''}`, source };
  }
  return { canonical: registry.get(cleaned) || cleaned, source };
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
