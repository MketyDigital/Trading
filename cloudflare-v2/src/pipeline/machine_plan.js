import { normalizeOrderIntent, normalizeSymbol } from '../normalization/trading_normalizer.js';

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

function numbers(text) {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

function managementPlan(text) {
  const upper = text.toUpperCase();
  if (/MOVE\s+(?:SL\s+)?(?:TO\s+)?BE\b|BREAK\s*EVEN|BREAKEVEN/.test(upper)) {
    return { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } };
  }
  if (/CLOSE\s+HALF|CLOSE\s+50%/.test(upper)) {
    return { status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 } };
  }
  if (/CANCEL\s+(?:THE\s+)?PENDING/.test(upper)) {
    return { status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING' } };
  }
  if (/CLOSE\s+ALL/.test(upper)) return { status: 'MANAGEMENT', management: { type: 'CLOSE_ALL' } };
  if (/\bCLOSE\b/.test(upper)) return { status: 'MANAGEMENT', management: { type: 'CLOSE' } };
  return null;
}

function extractExplicitTps(text) {
  const labeled = [];
  for (const match of text.matchAll(/\bTP([1-9]\d?)\s*[:@-]?\s*(-?\d+(?:\.\d+)?)/gi)) {
    labeled.push({ index: Number(match[1]), value: Number(match[2]) });
  }
  for (const match of text.matchAll(/\bTP\s+([1-9]\d?)\s*[:@-]\s*(-?\d+(?:\.\d+)?)/gi)) {
    labeled.push({ index: Number(match[1]), value: Number(match[2]) });
  }
  if (labeled.length) {
    const unique = new Map(labeled.map((item) => [item.index, item.value]));
    return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  }

  const generic = text.match(/\bTP\b\s*[:@-]?\s*(.+)$/i);
  if (!generic) return [];
  return numbers(generic[1]);
}

function sideMatch(text) {
  const match = text.match(/\b(BUY|SELL|LONG|SHORT)\b/i);
  if (!match) return null;
  return {
    raw: match[1],
    side: /BUY|LONG/i.test(match[1]) ? 'BUY' : 'SELL',
    index: match.index,
    end: match.index + match[0].length,
  };
}

function cleanCandidate(value) {
  return String(value ?? '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/[^A-Za-z0-9_./#&() -]+$/g, '')
    .trim();
}

function concisePrefixSymbol(before) {
  const cleaned = cleanCandidate(before)
    .replace(/^\s*(?:SIGNAL|TRADE|ENTRY)\s*[:=-]?\s*/i, '')
    .trim();
  if (!cleaned) return null;

  // Symbol-before-side forms should be concise (e.g. "XAUUSD BUY" or
  // "GOLD BUY"). Longer prose such as "Gold is good here, buy ..." must
  // fall through to AI rather than treating the final prose word as a symbol.
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length > 2) return null;

  const synthetic = cleaned.match(/^(Volatility\s+\d+(?:\s*\(1s\)|\s+1s)?(?:\s+Index)?|Boom\s+\d+(?:\s+Index)?|Crash\s+\d+(?:\s+Index)?|Step\s+Index|Jump\s+\d+(?:\s+Index)?)$/i)?.[1];
  if (synthetic) return synthetic;

  if (tokens.length === 1 && /^[A-Za-z][A-Za-z0-9_./#&.-]{1,24}$/.test(tokens[0])) return tokens[0];
  return null;
}

function extractSymbolToken(text, sideInfo) {
  const beforeSymbol = concisePrefixSymbol(text.slice(0, sideInfo.index));
  if (beforeSymbol) return beforeSymbol;

  let after = text.slice(sideInfo.end).trim();
  after = after.replace(/^\s*(?:STOP\s+LIMIT|LIMIT|STOP|MARKET)\b/i, '').trim();
  after = after.replace(/^\s*NOW\b/i, '').trim();
  after = after.replace(/^\s*[@:=-]+\s*/, '');

  const synthetic = after.match(/^(Volatility\s+\d+(?:\s*\(1s\)|\s+1s)?(?:\s+Index)?|Boom\s+\d+(?:\s+Index)?|Crash\s+\d+(?:\s+Index)?|Step\s+Index|Jump\s+\d+(?:\s+Index)?)/i)?.[1];
  if (synthetic) return synthetic;

  const first = after.match(/^([A-Za-z][A-Za-z0-9_./#&.-]{1,24})\b/)?.[1];
  return first || null;
}

function extractEntry(text, symbolToken) {
  const explicit = text.match(/\bENTRY(?:\s+PRICE)?\s*[:=@-]?\s*(-?\d+(?:\.\d+)?)(?:\s*[-–—]\s*(-?\d+(?:\.\d+)?))?/i);
  if (explicit) {
    const a = Number(explicit[1]);
    if (explicit[2] != null) {
      const b = Number(explicit[2]);
      return { kind: 'RANGE', min: Math.min(a, b), max: Math.max(a, b) };
    }
    return { kind: 'PRICE', value: a };
  }

  let head = text.split(/\b(?:SL|TP)\b/i)[0];
  if (symbolToken) head = head.replace(new RegExp(symbolToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  head = head
    .replace(/\b(?:BUY|SELL|LONG|SHORT|STOP\s+LIMIT|LIMIT|STOP|MARKET|NOW|ENTRY)\b/gi, ' ')
    .replace(/[^0-9.\-–—]+/g, ' ')
    .trim();

  const range = head.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    return { kind: 'RANGE', min: Math.min(a, b), max: Math.max(a, b) };
  }

  const price = head.match(/-?\d+(?:\.\d+)?/);
  return price ? { kind: 'PRICE', value: Number(price[0]) } : null;
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
  const symbol = normalizeSymbol(symbolToken);

  const stopLossMatch = text.match(/\bSL\s*[:@=-]?\s*(-?\d+(?:\.\d+)?)/i);
  const stopLoss = stopLossMatch ? Number(stopLossMatch[1]) : null;
  const takeProfits = extractExplicitTps(text);
  const entry = extractEntry(text, symbolToken);
  const fastEntry = /\bNOW\b/i.test(text) && !stopLoss && takeProfits.length === 0 && !entry;

  if (!fastEntry && !entry && order.orderType !== 'MARKET') return { status: 'NEEDS_INTERPRETATION' };
  if (!fastEntry && !entry && !stopLoss && takeProfits.length === 0) return { status: 'NEEDS_INTERPRETATION' };

  return {
    status: 'READY',
    intent: {
      side: sideInfo.side,
      orderType: order.orderType,
      symbol,
      entry: entry || { kind: 'MARKET' },
      stopLoss,
      takeProfits,
      fastEntry,
      incomplete: fastEntry || !stopLoss || takeProfits.length === 0,
    },
  };
}
