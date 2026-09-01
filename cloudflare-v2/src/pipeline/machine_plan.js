import { normalizeOrderIntent, normalizeSymbol } from '../normalization/trading_normalizer.js';

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

export function buildMachinePlan(event = {}) {
  const text = String(event.text ?? '').trim();
  if (!text) return { status: 'NO_ACTION' };

  const management = managementPlan(text);
  if (management) return management;

  const upper = text.toUpperCase();
  const order = normalizeOrderIntent(upper);
  if (!order.side) return { status: 'NEEDS_INTERPRETATION' };

  const sideIndex = upper.indexOf(order.side);
  const afterSide = text.slice(sideIndex + order.side.length).trim();
  const typeWords = order.orderType === 'STOP_LIMIT' ? 'STOP LIMIT' : order.orderType === 'MARKET' ? '' : order.orderType;
  const afterType = typeWords ? afterSide.replace(new RegExp(`^${typeWords}\\b`, 'i'), '').trim() : afterSide;
  const symbolToken = afterType.match(/^([A-Za-z0-9_./ -]+?)(?=\s+-?\d|\s+NOW\b|\s+SL\b|\s+TP\b|$)/i)?.[1]?.trim();
  if (!symbolToken) return { status: 'NEEDS_INTERPRETATION' };

  const symbol = normalizeSymbol(symbolToken);
  const fastEntry = /\bNOW\b/i.test(text) && !/\bSL\b|\bTP\b/i.test(text);

  let entry = null;
  const rangeMatch = afterType.match(/\b(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    entry = { kind: 'RANGE', min: Math.min(a, b), max: Math.max(a, b) };
  } else {
    const symbolEnd = afterType.toUpperCase().indexOf(symbolToken.toUpperCase()) + symbolToken.length;
    const remainder = afterType.slice(symbolEnd);
    const entryMatch = remainder.match(/\b(-?\d+(?:\.\d+)?)/);
    if (entryMatch && !/^\s*(?:SL|TP)\b/i.test(remainder)) entry = { kind: 'PRICE', value: Number(entryMatch[1]) };
  }

  const slMatch = text.match(/\bSL\s*[:@-]?\s*(-?\d+(?:\.\d+)?)/i);
  const stopLoss = slMatch ? Number(slMatch[1]) : null;
  const takeProfits = extractExplicitTps(text);

  if (!fastEntry && !entry && order.orderType !== 'MARKET') return { status: 'NEEDS_INTERPRETATION' };
  if (!fastEntry && !entry && !stopLoss && takeProfits.length === 0) return { status: 'NEEDS_INTERPRETATION' };

  return {
    status: 'READY',
    intent: {
      side: order.side,
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
