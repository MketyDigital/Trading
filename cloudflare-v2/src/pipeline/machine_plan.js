import { normalizeOrderIntent, normalizeSymbol } from '../normalization/trading_normalizer.js';

const MARKET_COMMAND_BLOCKER = /\b(?:MAYBE|LATER|TOMORROW|WATCH|WATCHING|CONSIDER|CONSIDERING|IF|WAIT|WAITING|POSSIBLE|POSSIBLY|LOOKING|INTERESTING|THINK|THINKING|MIGHT|MAY|COULD|SHOULD|WOULD|CAN|AVOID|NEVER|DONT|DON'T|NOT)\b/i;
const KNOWN_COMPACT_SYMBOL = /^(?:GOLD|XAU|XAUUSD|SILVER|XAG|XAGUSD|BITCOIN|BTC|BTCUSD|ETHEREUM|ETHER|ETH|ETHUSD|DJ30|DJI|DOW|DOWJONES|US30|USTEC|US100|NASDAQ|NASDAQ100|NAS100|SPX500|SP500|US500|DAX|DAX40|GER40|FTSE|FTSE100|UK100|NIKKEI|NIKKEI225|JP225|HANGSENG|HSI|HK50|WTI|WTICRUDE|CRUDEOIL|USOIL|BRENT|BRENTCRUDE|UKOIL)$/i;
const MANAGEMENT_COMMAND_WORD = /^(?:MOVE|SL|STOP|TO|BE|BREAK|EVEN|BREAKEVEN|CLOSE|HALF|CANCEL|THE|PENDING|ALL)$/i;

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

function numbers(text) { return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0])); }

function managementSymbol(text) {
  const tokens = String(text ?? '').match(/[A-Za-z][A-Za-z0-9_./#&.-]{1,24}/g) || [];
  for (const token of tokens) {
    if (MANAGEMENT_COMMAND_WORD.test(token)) continue;
    if (!isLikelyCompactSymbol(token)) continue;
    return normalizeSymbol(token);
  }
  return null;
}

function withManagementSymbol(text, management) {
  const symbol = managementSymbol(text);
  return symbol ? { status: 'MANAGEMENT', management: { ...management, symbol } } : { status: 'MANAGEMENT', management };
}

function managementPlan(text) {
  const upper = text.toUpperCase();
  if (!isConfidentExecutionInstruction(text)) return null;
  if (/\bMOVE\b(?:.|\s)*\b(?:SL|STOP)\b(?:.|\s)*\b(?:BE|BREAK\s*EVEN|BREAKEVEN)\b|\bBREAK\s*EVEN\b|\bBREAKEVEN\b/.test(upper)) {
    return withManagementSymbol(text, { type: 'MOVE_SL_TO_BE' });
  }
  if (/\bCLOSE\s+(?:HALF|50%)\b|\b(?:HALF|50%)\s+CLOSE\b/.test(upper)) {
    return withManagementSymbol(text, { type: 'CLOSE_PARTIAL', fraction: 0.5 });
  }
  if (/\bCANCEL\b(?:\s+(?:THE\s+)?[A-Z0-9_./#&.-]+)?\s+PENDING\b/.test(upper)) {
    return withManagementSymbol(text, { type: 'CANCEL_PENDING' });
  }
  if (/\bCLOSE\s+ALL\b/.test(upper)) return { status: 'MANAGEMENT', management: { type: 'CLOSE_ALL' } };
  if (/\bCLOSE\b/.test(upper)) return withManagementSymbol(text, { type: 'CLOSE' });
  return null;
}

function extractExplicitTps(text) {
  const labeled = [];
  for (const match of text.matchAll(/\bTP([1-9]\d?)\s*[:@-]?\s*(-?\d+(?:\.\d+)?)/gi)) labeled.push({ index: Number(match[1]), value: Number(match[2]) });
  for (const match of text.matchAll(/\bTP\s+([1-9]\d?)\s*[:@-]\s*(-?\d+(?:\.\d+)?)/gi)) labeled.push({ index: Number(match[1]), value: Number(match[2]) });
  if (labeled.length) {
    const unique = new Map(labeled.map((item) => [item.index, item.value]));
    return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  }
  const generic = text.match(/\bTP\b\s*[:@-]?\s*(.+)$/i);
  return generic ? numbers(generic[1]) : [];
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
  const synthetic = cleaned.match(/^(Volatility\s+\d+(?:\s*\(1s\)|\s+1s)?(?:\s+Index)?|Boom\s+\d+(?:\s+Index)?|Crash\s+\d+(?:\s+Index)?|Step\s+Index|Jump\s+\d+(?:\s+Index)?)$/i)?.[1];
  if (synthetic) return synthetic;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && isLikelyCompactSymbol(tokens[0])) return tokens[0];
  return null;
}

function extractSymbolToken(text, sideInfo) {
  const beforeSymbol = concisePrefixSymbol(text.slice(0, sideInfo.index));
  if (beforeSymbol) return beforeSymbol;

  let after = text.slice(sideInfo.end).trim();
  after = after.replace(/^\s*(?:STOP\s+LIMIT|LIMIT|STOP|MARKET)\b/i, '').trim();
  after = after.replace(/^\s*NOW\b/i, '').trim();
  after = after.replace(/^\s*[@:=-]+\s*/, '');

  if (/^(?:AROUND|NEAR|ABOUT|FROM|HERE|NOW\s+AROUND|AT\s+(?:AROUND|ABOUT))\b/i.test(after)) return null;

  const synthetic = after.match(/^(Volatility\s+\d+(?:\s*\(1s\)|\s+1s)?(?:\s+Index)?|Boom\s+\d+(?:\s+Index)?|Crash\s+\d+(?:\s+Index)?|Step\s+Index|Jump\s+\d+(?:\s+Index)?)/i)?.[1];
  if (synthetic) return synthetic;
  const compact = after.match(/^([A-Za-z][A-Za-z0-9_./#&.-]{1,24})\b/)?.[1] || null;
  return compact && isLikelyCompactSymbol(compact) ? compact : null;
}

function extractEntry(text, symbolToken) {
  const explicit = text.match(/\bENTRY(?:\s+PRICE)?\s*[:=@-]?\s*(-?\d+(?:\.\d+)?)(?:\s*[-–—]\s*(-?\d+(?:\.\d+)?))?/i);
  if (explicit) {
    const a = Number(explicit[1]);
    if (explicit[2] != null) { const b = Number(explicit[2]); return { kind: 'RANGE', min: Math.min(a, b), max: Math.max(a, b) }; }
    return { kind: 'PRICE', value: a };
  }
  let head = text.split(/\b(?:SL|TP)\b/i)[0];
  if (symbolToken) head = head.replace(new RegExp(symbolToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  head = head.replace(/\b(?:BUY|SELL|LONG|SHORT|STOP\s+LIMIT|LIMIT|STOP|MARKET|NOW|ENTRY)\b/gi, ' ').replace(/[^0-9.\-–—]+/g, ' ').trim();
  const range = head.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (range) { const a = Number(range[1]); const b = Number(range[2]); return { kind: 'RANGE', min: Math.min(a, b), max: Math.max(a, b) }; }
  const price = head.match(/-?\d+(?:\.\d+)?/);
  return price ? { kind: 'PRICE', value: Number(price[0]) } : null;
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

  const symbol = normalizeSymbol(symbolToken);
  const stopLossMatch = text.match(/\bSL\s*[:@=-]?\s*(-?\d+(?:\.\d+)?)/i);
  const stopLoss = stopLossMatch ? Number(stopLossMatch[1]) : null;
  const takeProfits = extractExplicitTps(text);
  const entry = extractEntry(text, symbolToken);
  const fastEntry = order.orderType === 'MARKET'
    && !entry
    && !stopLoss
    && takeProfits.length === 0;
  if (fastEntry && !isConciseFastMarketCommand(text, symbolToken)) return { status: 'NEEDS_INTERPRETATION' };
  if (!fastEntry && !entry && order.orderType !== 'MARKET') return { status: 'NEEDS_INTERPRETATION' };
  if (!fastEntry && !entry && !stopLoss && takeProfits.length === 0) return { status: 'NEEDS_INTERPRETATION' };
  return { status: 'READY', intent: { side: sideInfo.side, orderType: order.orderType, symbol, entry: entry || { kind: 'MARKET' }, stopLoss, takeProfits, fastEntry, incomplete: fastEntry || !stopLoss || takeProfits.length === 0 } };
}
