import { normalizeOrderIntent, normalizeSymbol } from '../normalization/trading_normalizer.js';
import { parseSignalNumber, SIGNAL_NUMBER_SOURCE } from '../normalization/signal_number.js';

const MARKET_COMMAND_BLOCKER = /\b(?:MAYBE|LATER|TOMORROW|WATCH|WATCHING|CONSIDER|CONSIDERING|IF|WAIT|WAITING|POSSIBLE|POSSIBLY|LOOKING|INTERESTING|THINK|THINKING|MIGHT|MAY|COULD|SHOULD|WOULD|CAN|AVOID|NEVER|DONT|DON'T|NOT)\b/i;
const KNOWN_COMPACT_SYMBOL = /^(?:GOLD|XAU|XAUUSD|SILVER|XAG|XAGUSD|BITCOIN|BTC|BTCUSD|ETHEREUM|ETHER|ETH|ETHUSD|DJ30|DJI|DOW|DOWJONES|US30|USTEC|US100|NASDAQ|NASDAQ100|NAS100|SPX500|SP500|US500|DAX|DAX40|GER40|FTSE|FTSE100|UK100|NIKKEI|NIKKEI225|JP225|HANGSENG|HSI|HK50|WTI|WTICRUDE|CRUDEOIL|USOIL|BRENT|BRENTCRUDE|UKOIL)$/i;
const MANAGEMENT_COMMAND_WORD = /^(?:MOVE|TRAIL|SET|UPDATE|SL|STOP|TO|BE|BREAK|EVEN|BREAKEVEN|RISK|FREE|SECURE|PROFITS|CHANGE|NEW|TP(?:[1-9]\d?)?|CLOSE|HALF|CANCEL|DELETE|THE|PENDING|ALL|HOLD|KEEP|RUNNING|HIT|LAYERS|NOW|AND|MAKE|SURE)$/i;
const DERIV_SHORT = /^V(10|15|25|30|50|75|90|100)(?:\s*\(\s*1S\s*\))?(?:\s+INDEX)?$/i;
const DERIV_SYNTHETIC_SYMBOL_SOURCE = String.raw`(?:Volatility\s+\d+(?:\s*\(1s\)|\s+1s)?(?:\s+Index)?|Boom\s+\d+(?:\s+Index)?|Crash\s+\d+(?:\s+Index)?|Step\s+Index|Jump\s+\d+(?:\s+Index)?)`;
const DERIV_SYNTHETIC_SYMBOL = new RegExp(`^${DERIV_SYNTHETIC_SYMBOL_SOURCE}$`, 'i');
const OPTIONAL_MANAGEMENT_SYMBOL_WORDS = String.raw`(?:\s+(?:THE\s+)?[A-Z0-9_./#&().-]+){0,8}`;

function normalizeSignalText(value) {
  return String(value ?? '')
    .replace(/S\s*\/\s*L/gi, 'SL')
    .replace(/T\s*\/\s*P/gi, 'TP')
    .replace(/TAKE\s+PROFIT/gi, 'TP')
    .replace(/STOP\s+LOSS/gi, 'SL')
    .replace(/\r/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

function extractDerivSyntheticSymbol(value, { anchored = true } = {}) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const pattern = anchored ? DERIV_SYNTHETIC_SYMBOL : new RegExp(DERIV_SYNTHETIC_SYMBOL_SOURCE, 'i');
  return text.match(pattern)?.[0] || null;
}

function parsedNumber(raw) {
  const parsed = parseSignalNumber(raw, { allowNegative: true });
  return parsed.ok ? parsed.value : null;
}

function hasAmbiguousCommaNumber(text) {
  const candidates = String(text ?? '').match(/-?\d(?:[\d,]*\d)?(?:\.\d+)?/g) || [];
  return candidates.some((candidate) => candidate.includes(',') && !parseSignalNumber(candidate, { allowNegative: true }).ok);
}

function numbers(text) {
  const matches = String(text ?? '').match(new RegExp(SIGNAL_NUMBER_SOURCE, 'g')) || [];
  const values = [];
  for (const raw of matches) {
    const value = parsedNumber(raw);
    if (value == null) return null;
    values.push(value);
  }
  return values;
}

function normalizeDetectedSymbol(value) {
  const source = String(value ?? '').trim();
  const short = source.match(DERIV_SHORT);
  if (!short) return normalizeSymbol(source);
  const is1s = /\(\s*1S\s*\)/i.test(source);
  return { canonical: `DERIV:VOLATILITY_${short[1]}${is1s ? '_1S' : ''}`, source };
}

function managementSymbol(text) {
  const synthetic = extractDerivSyntheticSymbol(text, { anchored: false });
  if (synthetic) return normalizeDetectedSymbol(synthetic);

  const tokens = String(text ?? '').match(/[A-Za-z][A-Za-z0-9_./#&().-]{1,24}/g) || [];
  for (const token of tokens) {
    if (MANAGEMENT_COMMAND_WORD.test(token)) continue;
    if (!isLikelyCompactSymbol(token)) continue;
    return normalizeDetectedSymbol(token);
  }
  return null;
}

function withManagementSymbol(text, management) {
  const symbol = managementSymbol(text);
  return symbol ? { status: 'MANAGEMENT', management: { ...management, symbol } } : { status: 'MANAGEMENT', management };
}

function informationalManagementPlan(text) {
  const upper = text.toUpperCase();
  if (/^\s*(?:HOLD|KEEP\s+RUNNING)\s*[!.]*\s*$/.test(upper)) {
    return { status: 'NO_ACTION', reason: 'INFORMATIONAL_MANAGEMENT', information: { type: 'HOLD_POSITION' } };
  }
  return null;
}

function managementPlan(text) {
  const informational = informationalManagementPlan(text);
  if (informational) return informational;

  const upper = text.toUpperCase();
  if (!isConfidentExecutionInstruction(text)) return null;
  const containsTradeSide = /\b(?:BUY|SELL|LONG|SHORT)\b/.test(upper);

  const targetHit = upper.match(/^\s*TP\s*([1-9]\d?)\s*(?:HIT\s*)?(?:✅+|[!.]+)?\s*$/u);
  if (targetHit) {
    return { status: 'MANAGEMENT', management: { type: 'TARGET_HIT', targetIndex: Number(targetHit[1]) } };
  }

  const closeHalfRequested = /\bSECURE\s+PROFITS\b|\bCLOSE\s+(?:HALF|50\s*%)\b|\b(?:HALF|50\s*%)\s+CLOSE\b/.test(upper);
  const breakEvenRequested = /\b(?:RISK\s+FREE|SET\s+(?:SL\s+TO\s+)?(?:BE|BREAK\s+EVEN|BREAKEVEN))\b/.test(upper)
    || new RegExp(`\\bMOVE\\b${OPTIONAL_MANAGEMENT_SYMBOL_WORDS}\\s+(?:SL|STOP)\\b(?:\\s+TO)?\\s+(?:BE|BREAK\\s+EVEN|BREAKEVEN)\\b`).test(upper)
    || /\bBREAK\s+EVEN\b|\bBREAKEVEN\b/.test(upper)
    || /\bMAKE\s+SURE\s+(?:(?:SL|STOP)\s+(?:IS\s+)?(?:AT|TO)\s+)?BE\b/.test(upper);

  if (closeHalfRequested && breakEvenRequested) {
    return withManagementSymbol(text, {
      type: 'COMPOUND',
      actions: [
        { type: 'CLOSE_PARTIAL', fraction: 0.5 },
        { type: 'MOVE_SL_TO_BE' },
      ],
    });
  }

  if (/\bSECURE\s+PROFITS\b/.test(upper)) {
    return withManagementSymbol(text, { type: 'CLOSE_PARTIAL', fraction: 0.5 });
  }

  if (breakEvenRequested) {
    return withManagementSymbol(text, { type: 'MOVE_SL_TO_BE' });
  }

  const explicitSlPattern = new RegExp(`\\b(?:MOVE|TRAIL|CHANGE|NEW|UPDATE|SET)${OPTIONAL_MANAGEMENT_SYMBOL_WORDS}\\s+(?:SL|STOP)(?:\\s+TO)?\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})\\b`, 'i');
  const directSlPattern = new RegExp(`\\b(?:SL|STOP)(?:\\s+TO)?\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})\\b`, 'i');
  const moveSl = text.match(explicitSlPattern) || (!containsTradeSide ? text.match(directSlPattern) : null);
  if (moveSl) {
    const stopLoss = parsedNumber(moveSl[1]);
    if (stopLoss == null) return null;
    return withManagementSymbol(text, { type: 'MOVE_SL', stopLoss });
  }

  const explicitTpPattern = new RegExp(`\\b(?:CHANGE|NEW|MOVE|SET|UPDATE)${OPTIONAL_MANAGEMENT_SYMBOL_WORDS}\\s+TP\\s*([1-9]\\d?)?(?:\\s+TO)?\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})\\b`, 'i');
  const directTpPattern = new RegExp(`\\bTP\\s*([1-9]\\d?)?\\s*(?:TO\\s*)?[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})\\b`, 'i');
  const changeTp = text.match(explicitTpPattern) || (!containsTradeSide ? text.match(directTpPattern) : null);
  if (changeTp) {
    const takeProfit = parsedNumber(changeTp[2]);
    if (takeProfit == null) return null;
    const targetIndex = changeTp[1] ? Number(changeTp[1]) : null;
    return withManagementSymbol(text, {
      type: 'CHANGE_TP',
      takeProfit,
      ...(targetIndex ? { targetIndex } : {}),
    });
  }

  if (/\bCLOSE\s+(?:HALF|50%)\b|\b(?:HALF|50%)\s+CLOSE\b/.test(upper)) {
    return withManagementSymbol(text, { type: 'CLOSE_PARTIAL', fraction: 0.5 });
  }
  const closePercent = upper.match(/\bCLOSE\s+(\d{1,3}(?:\.\d+)?)\s*%\b/);
  if (closePercent) {
    const percent = Number(closePercent[1]);
    if (percent > 0 && percent < 100) {
      return withManagementSymbol(text, { type: 'CLOSE_PARTIAL', fraction: percent / 100 });
    }
  }
  if (new RegExp(`\\b(?:CANCEL|DELETE)\\b${OPTIONAL_MANAGEMENT_SYMBOL_WORDS}\\s+PENDING\\b`).test(upper)) {
    return withManagementSymbol(text, { type: 'CANCEL_PENDING' });
  }
  if (/\bCLOSE\s+ALL\b/.test(upper)) return { status: 'MANAGEMENT', management: { type: 'CLOSE_ALL' } };
  if (/\bCLOSE\b/.test(upper)) return withManagementSymbol(text, { type: 'CLOSE' });
  return null;
}

function tpSegmentValues(segment) {
  const source = String(segment ?? '').trim().replace(/^[,;|]+|[,;|]+$/g, '').trim();
  if (!source) return [];

  const whole = parsedNumber(source);
  if (whole != null) return [whole];

  const matcher = new RegExp(SIGNAL_NUMBER_SOURCE, 'g');
  const matches = [...source.matchAll(matcher)];
  if (!matches.length) return null;

  const values = [];
  let cursor = 0;
  for (const match of matches) {
    const separator = source.slice(cursor, match.index);
    if (separator && !/^[\s,;|/]+$/.test(separator)) return null;
    const value = parsedNumber(match[0]);
    if (value == null) return null;
    values.push(value);
    cursor = Number(match.index) + match[0].length;
  }
  const trailing = source.slice(cursor);
  if (trailing && !/^[\s,;|/]+$/.test(trailing)) return null;
  return values;
}

function extractExplicitTps(text) {
  const labeled = [];
  const compactPattern = new RegExp(`\\bTP([1-9]\\d?)\\s*[:@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'gi');
  const spacedPattern = new RegExp(`\\bTP\\s+([1-9]\\d?)\\s*[:@-]\\s*(${SIGNAL_NUMBER_SOURCE})`, 'gi');
  for (const match of text.matchAll(compactPattern)) {
    const value = parsedNumber(match[2]);
    if (value == null) return null;
    labeled.push({ index: Number(match[1]), value });
  }
  for (const match of text.matchAll(spacedPattern)) {
    const value = parsedNumber(match[2]);
    if (value == null) return null;
    labeled.push({ index: Number(match[1]), value });
  }
  if (labeled.length) {
    const unique = new Map();
    for (const item of labeled) {
      if (unique.has(item.index) && unique.get(item.index) !== item.value) return null;
      unique.set(item.index, item.value);
    }
    return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  }

  const marker = /\bTP\b\s*[:@-]?\s*/gi;
  const markers = [...text.matchAll(marker)];
  if (!markers.length) return [];

  const values = [];
  for (let i = 0; i < markers.length; i += 1) {
    const start = Number(markers[i].index) + markers[i][0].length;
    const end = i + 1 < markers.length ? Number(markers[i + 1].index) : text.length;
    let segment = text.slice(start, end);
    const nextField = segment.search(/\b(?:SL|ENTRY(?:\s+(?:PRICE|ZONE))?|BUY|SELL|LONG|SHORT)\b/i);
    if (nextField >= 0) segment = segment.slice(0, nextField);
    const parsed = tpSegmentValues(segment);
    if (parsed == null) return null;
    values.push(...parsed);
  }
  return values;
}

function sideMatch(text) {
  const match = text.match(/\b(BUY|SELL|LONG|SHORT)\b/i);
  if (!match) return null;
  return { raw: match[1], side: /BUY|LONG/i.test(match[1]) ? 'BUY' : 'SELL', index: match.index, end: match.index + match[0].length };
}

function cleanCandidate(value) {
  return String(value ?? '').replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9_./#&() -]+$/g, '').trim();
}

function isLikelyCompactSymbol(value) {
  const candidate = cleanCandidate(value);
  if (!candidate || /\s/.test(candidate)) return false;
  if (KNOWN_COMPACT_SYMBOL.test(candidate)) return true;
  if (DERIV_SHORT.test(candidate)) return true;
  if (/^[A-Za-z]{3}[./_-]?[A-Za-z]{3}(?:[._-]?[A-Za-z0-9]{1,8})?$/.test(candidate)) return true;
  if (/^[A-Za-z]{2,10}\d{1,5}(?:[A-Za-z0-9._-]{0,8})?$/.test(candidate)) return true;
  return false;
}

function concisePrefixSymbol(before) {
  const cleaned = cleanCandidate(before)
    .replace(/^\s*(?:SIGNAL|TRADE|ENTRY)\s*[:=-]?\s*/i, '')
    .replace(/^\s*PLEASE\b\s*/i, '')
    .trim();
  if (!cleaned) return null;
  const synthetic = extractDerivSyntheticSymbol(cleaned);
  if (synthetic) return synthetic;
  if (DERIV_SHORT.test(cleaned)) return cleaned;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && isLikelyCompactSymbol(tokens[0])) return tokens[0];
  return null;
}

function labeledInstrument(text) {
  const match = String(text ?? '').match(/\bINSTRUMENT\s*:\s*([^\n]+)/i);
  if (!match) return null;
  const candidate = cleanCandidate(match[1]);
  const synthetic = extractDerivSyntheticSymbol(candidate, { anchored: false });
  if (synthetic) return synthetic;
  return isLikelyCompactSymbol(candidate) ? candidate : null;
}

function extractSymbolToken(text, sideInfo) {
  const labeled = labeledInstrument(text);
  if (labeled) return labeled;

  const beforeSymbol = concisePrefixSymbol(text.slice(0, sideInfo.index));
  if (beforeSymbol) return beforeSymbol;

  let after = text.slice(sideInfo.end).trim();
  after = after.replace(/^\s*(?:STOP\s+LIMIT|LIMIT|STOP|MARKET)\b/i, '').trim();
  after = after.replace(/^\s*NOW\b/i, '').trim();
  after = after.replace(/^\s*[@:=-]+\s*/, '');

  if (/^(?:AROUND|NEAR|ABOUT|FROM|HERE|NOW\s+AROUND|AT\s+(?:AROUND|ABOUT))\b/i.test(after)) return null;

  const synthetic = extractDerivSyntheticSymbol(after, { anchored: false });
  if (synthetic) return synthetic;
  const derivShort = after.match(/^(V(?:10|15|25|30|50|75|90|100)(?:\s*\(\s*1s\s*\))?(?:\s+index)?)/i)?.[1];
  if (derivShort) return derivShort;
  const compact = after.match(/^([A-Za-z][A-Za-z0-9_./#&.-]{1,24})\b/)?.[1] || null;
  return compact && isLikelyCompactSymbol(compact) ? compact : null;
}

function extractEntry(text, symbolToken) {
  const explicitPattern = new RegExp(`\\bENTRY(?:\\s+(?:PRICE|ZONE))?\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})(?:\\s*[-–—]\\s*(${SIGNAL_NUMBER_SOURCE}))?`, 'i');
  const explicit = text.match(explicitPattern);
  if (explicit) {
    const a = parsedNumber(explicit[1]);
    if (a == null) return null;
    if (explicit[2] != null) {
      const b = parsedNumber(explicit[2]);
      if (b == null) return null;
      return { kind: 'RANGE', min: Math.min(a, b), max: Math.max(a, b) };
    }
    return { kind: 'PRICE', value: a };
  }

  let head = text.split(/\b(?:SL|TP)\b/i)[0];
  if (symbolToken) head = head.replace(new RegExp(symbolToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  head = head.replace(/\b(?:BUY|SELL|LONG|SHORT|STOP\s+LIMIT|LIMIT|STOP|MARKET|NOW|ENTRY)\b/gi, ' ')
    .replace(/[@():=]+/g, ' ')
    .trim();

  const rangePattern = new RegExp(`(${SIGNAL_NUMBER_SOURCE})\\s*[-–—]\\s*(${SIGNAL_NUMBER_SOURCE})`);
  const range = head.match(rangePattern);
  if (range) {
    const a = parsedNumber(range[1]);
    const b = parsedNumber(range[2]);
    if (a == null || b == null) return null;
    return { kind: 'RANGE', min: Math.min(a, b), max: Math.max(a, b) };
  }
  const price = head.match(new RegExp(SIGNAL_NUMBER_SOURCE));
  if (!price) return null;
  const value = parsedNumber(price[0]);
  return value == null ? null : { kind: 'PRICE', value };
}

function isConfidentExecutionInstruction(text) {
  if (text.includes('?')) return false;
  if (/\bDO\s+NOT\b/i.test(text)) return false;
  return !MARKET_COMMAND_BLOCKER.test(text);
}

function isConciseFastMarketCommand(text, symbolToken) {
  const escapedSymbol = symbolToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const residue = text
    .replace(new RegExp(escapedSymbol, 'i'), ' ')
    .replace(/\b(?:BUY|SELL|LONG|SHORT|MARKET|NOW|PLEASE|SIGNAL|TRADE)\b/gi, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim();
  return residue.length === 0;
}

export function buildMachinePlan(event = {}) {
  const text = normalizeSignalText(event.text);
  if (!text) return { status: 'NO_ACTION' };
  const management = managementPlan(text);
  if (management) return management;
  const order = normalizeOrderIntent(text);
  const sideInfo = sideMatch(text);
  if (!order.side || !sideInfo) return { status: 'NEEDS_INTERPRETATION' };
  const symbolToken = extractSymbolToken(text, sideInfo);
  if (!symbolToken) return { status: 'NEEDS_INTERPRETATION' };

  if (!isConfidentExecutionInstruction(text)) return { status: 'NEEDS_INTERPRETATION' };
  if (hasAmbiguousCommaNumber(text)) return { status: 'NEEDS_INTERPRETATION' };

  const symbol = normalizeDetectedSymbol(symbolToken);
  const stopLossPattern = new RegExp(`\\bSL\\s*[:@=-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'i');
  const stopLossMatch = text.match(stopLossPattern);
  const stopLoss = stopLossMatch ? parsedNumber(stopLossMatch[1]) : null;
  if (stopLossMatch && stopLoss == null) return { status: 'NEEDS_INTERPRETATION' };
  const takeProfits = extractExplicitTps(text);
  if (takeProfits == null) return { status: 'NEEDS_INTERPRETATION' };

  const entry = extractEntry(text, symbolToken);
  const fastEntry = order.orderType === 'MARKET' && !entry && !stopLoss && takeProfits.length === 0 && isConciseFastMarketCommand(text, symbolToken);
  if (!fastEntry && !entry && !stopLoss && takeProfits.length === 0) return { status: 'NEEDS_INTERPRETATION' };
  return { status: 'READY', intent: { side: sideInfo.side, orderType: order.orderType, symbol, entry: entry || { kind: 'MARKET' }, stopLoss, takeProfits, fastEntry, incomplete: fastEntry || !stopLoss || takeProfits.length === 0 } };
}
