import { extractSignalNumbers } from '../normalization/signal_number.js';
import { normalizeSymbol } from '../normalization/trading_normalizer.js';

const EXECUTION_ORDER_TYPES = new Set(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']);
const EPSILON = 1e-9;
const NEGATED_SIDE_PATTERN = /\b(?:DO\s+NOT|DON['’]?T|NEVER)\s+(?:GO\s+)?(?:BUY|SELL|LONG|SHORT)\b/g;

function validationReference(intent) {
  if (intent?.entry?.kind === 'PRICE') return Number(intent.entry.value);
  if (intent?.entry?.kind === 'RANGE') return intent.side === 'BUY' ? Number(intent.entry.max) : Number(intent.entry.min);
  return null;
}

function protectionGeometryIssues(intent) {
  const reference = validationReference(intent);
  if (reference == null || !Number.isFinite(reference)) return [];
  const issues = [];

  if (intent.stopLoss != null) {
    const stop = Number(intent.stopLoss);
    if (!Number.isFinite(stop)) issues.push({ field: 'stopLoss', code: 'SL_INVALID_PRICE' });
    else if (intent.side === 'BUY' && !(stop < reference)) issues.push({ field: 'stopLoss', code: 'SL_INVALID_GEOMETRY' });
    else if (intent.side === 'SELL' && !(stop > reference)) issues.push({ field: 'stopLoss', code: 'SL_INVALID_GEOMETRY' });
  }

  for (const [index, rawTarget] of (intent.takeProfits || []).entries()) {
    const target = Number(rawTarget);
    if (!Number.isFinite(target)) issues.push({ field: 'takeProfits', targetIndex: index + 1, code: `TP${index + 1}_INVALID_PRICE` });
    else if (intent.side === 'BUY' && !(target > reference)) issues.push({ field: 'takeProfits', targetIndex: index + 1, code: `TP${index + 1}_INVALID_GEOMETRY` });
    else if (intent.side === 'SELL' && !(target < reference)) issues.push({ field: 'takeProfits', targetIndex: index + 1, code: `TP${index + 1}_INVALID_GEOMETRY` });
  }

  return issues;
}

function sanitizeProtection(intent, issues) {
  const invalidTargets = new Set(issues.filter((item) => item.field === 'takeProfits').map((item) => item.targetIndex));
  const stopInvalid = issues.some((item) => item.field === 'stopLoss');
  const takeProfits = (Array.isArray(intent.takeProfits) ? intent.takeProfits : [])
    .filter((_, index) => !invalidTargets.has(index + 1));
  const sanitized = {
    ...intent,
    ...(stopInvalid ? { stopLoss: null } : {}),
    takeProfits,
    incomplete: Boolean(intent.incomplete) || (stopInvalid ? true : intent.stopLoss == null) || takeProfits.length === 0,
  };
  return sanitized;
}

function normalizedRawText(rawText) {
  return String(rawText ?? '').toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function hasNegatedSideInstruction(rawText, side) {
  const sidePattern = side === 'BUY' ? '(?:BUY|LONG)' : '(?:SELL|SHORT)';
  const pattern = new RegExp(`\\b(?:DO\\s+NOT|DON['’]?T|NEVER)\\s+(?:GO\\s+)?${sidePattern}\\b`);
  return pattern.test(normalizedRawText(rawText));
}

function explicitSideFromText(rawText) {
  const text = normalizedRawText(rawText).replace(NEGATED_SIDE_PATTERN, ' ');
  const buy = /\b(?:BUY|LONG)\b/.test(text);
  const sell = /\b(?:SELL|SHORT)\b/.test(text);
  if (buy === sell) return null;
  return buy ? 'BUY' : 'SELL';
}

function explicitPendingOrderType(rawText) {
  const text = normalizedRawText(rawText);
  if (/\b(?:BUY|SELL)\s+STOP\s+LIMIT\b/.test(text) || /\bSTOP\s+LIMIT(?:\s+(?:ORDER|ENTRY))?\b/.test(text)) {
    return 'STOP_LIMIT';
  }
  if (/\b(?:BUY|SELL)\s+LIMIT\b/.test(text) || /\bLIMIT\s+(?:ORDER|ENTRY)\b/.test(text)) {
    return 'LIMIT';
  }
  if (/\b(?:BUY|SELL)\s+STOP\b/.test(text) || /\bSTOP\s+(?:ORDER|ENTRY)\b/.test(text)) {
    return 'STOP';
  }
  return null;
}

function validateRawOrderTypeEvidence(intent, rawText) {
  const explicitOrderType = explicitPendingOrderType(rawText);
  if (intent.orderType === 'MARKET') {
    if (explicitOrderType) {
      return { ok: false, reason: `AI MARKET order conflicts with raw ${explicitOrderType} instruction` };
    }
    return { ok: true };
  }

  if (!explicitOrderType) {
    return { ok: false, reason: `AI pending order lacks raw ${intent.orderType} evidence` };
  }
  if (explicitOrderType !== intent.orderType) {
    return { ok: false, reason: `AI ${intent.orderType} order conflicts with raw ${explicitOrderType} instruction` };
  }
  return { ok: true };
}

function rawSymbolCandidates(rawText) {
  const tokens = (String(rawText ?? '').match(/[A-Za-z0-9&:.()_/-]+/g) || [])
    .map((token) => token.replace(/^[.:]+|[.:]+$/g, ''))
    .filter(Boolean);
  const candidates = [];
  const maxWidth = Math.min(6, tokens.length);
  for (let width = 1; width <= maxWidth; width += 1) {
    for (let start = 0; start + width <= tokens.length; start += 1) {
      candidates.push(tokens.slice(start, start + width).join(' '));
    }
  }
  return candidates;
}

function hasRawSymbolEvidence(rawText, canonicalSymbol) {
  return rawSymbolCandidates(rawText).some((candidate) => normalizeSymbol(candidate).canonical === canonicalSymbol);
}

function executablePrices(intent) {
  const prices = [];
  if (intent?.entry?.kind === 'PRICE') prices.push(Number(intent.entry.value));
  if (intent?.entry?.kind === 'RANGE') {
    prices.push(Number(intent.entry.min));
    prices.push(Number(intent.entry.max));
  }
  if (intent?.stopLoss != null) prices.push(Number(intent.stopLoss));
  for (const target of intent?.takeProfits || []) prices.push(Number(target));
  return prices.filter(Number.isFinite);
}

function rawNumericEvidence(rawText) {
  return extractSignalNumbers(rawText)
    .filter((candidate) => candidate?.ok && Number.isFinite(candidate.value))
    .map((candidate) => Number(candidate.value));
}

function approximatelyEqual(left, right) {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= EPSILON * scale;
}

function advisoryRawPriceEvidence(intent, rawText) {
  const required = executablePrices(intent);
  if (required.length === 0) return [];
  const evidenced = rawNumericEvidence(rawText);
  const missing = required.filter((price) => !evidenced.some((rawPrice) => approximatelyEqual(price, rawPrice)));
  if (missing.length === 0) return [];
  return [`AI raw price evidence differs for ${missing.join(', ')}`];
}

export function validateCanonicalSignalIntent(intent, { rawText = '' } = {}) {
  if (!intent || typeof intent !== 'object') return { ok: false, reason: 'signal intent required' };
  if (!['BUY', 'SELL'].includes(intent.side)) return { ok: false, reason: 'invalid side' };
  if (!intent.symbol?.canonical) return { ok: false, reason: 'canonical symbol required' };
  if (!EXECUTION_ORDER_TYPES.has(intent.orderType)) return { ok: false, reason: 'invalid order type' };
  if (intent.orderType !== 'MARKET' && intent.entry?.kind === 'MARKET') {
    return { ok: false, reason: 'pending order requires explicit entry' };
  }

  // Protection values are independent. Discard only invalid SL/TP fields so a
  // bad protection price cannot erase an otherwise coherent side/symbol signal.
  const protectionWarnings = protectionGeometryIssues(intent);
  const executableIntent = sanitizeProtection(intent, protectionWarnings);

  if (hasNegatedSideInstruction(rawText, intent.side)) {
    return { ok: false, reason: `AI executable ${intent.side} is blocked by negated raw instruction` };
  }

  const explicitSide = explicitSideFromText(rawText);
  if (!explicitSide) {
    return { ok: false, reason: 'AI side lacks unambiguous raw evidence' };
  }
  if (explicitSide !== intent.side) {
    return { ok: false, reason: `AI side conflicts with raw ${explicitSide} instruction` };
  }

  if (!hasRawSymbolEvidence(rawText, intent.symbol.canonical)) {
    return { ok: false, reason: `AI symbol lacks raw evidence for ${intent.symbol.canonical}` };
  }

  const orderTypeEvidence = validateRawOrderTypeEvidence(intent, rawText);
  if (!orderTypeEvidence.ok) return orderTypeEvidence;

  return {
    ok: true,
    intent: executableIntent,
    protectionWarnings,
    warnings: advisoryRawPriceEvidence(executableIntent, rawText),
  };
}
