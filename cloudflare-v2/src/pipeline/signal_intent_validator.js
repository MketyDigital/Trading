import { extractSignalNumbers } from '../normalization/signal_number.js';

const EXECUTION_ORDER_TYPES = new Set(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']);
const EPSILON = 1e-9;

function validationReference(intent) {
  if (intent?.entry?.kind === 'PRICE') return Number(intent.entry.value);
  if (intent?.entry?.kind === 'RANGE') return intent.side === 'BUY' ? Number(intent.entry.max) : Number(intent.entry.min);
  return null;
}

function validateGeometry(intent) {
  const reference = validationReference(intent);
  if (reference == null || !Number.isFinite(reference)) return { ok: true };

  if (intent.stopLoss != null) {
    const stop = Number(intent.stopLoss);
    if (!Number.isFinite(stop)) return { ok: false, reason: 'invalid stop price' };
    if (intent.side === 'BUY' && !(stop < reference)) return { ok: false, reason: 'invalid BUY stop geometry' };
    if (intent.side === 'SELL' && !(stop > reference)) return { ok: false, reason: 'invalid SELL stop geometry' };
  }

  for (const rawTarget of intent.takeProfits || []) {
    const target = Number(rawTarget);
    if (!Number.isFinite(target)) return { ok: false, reason: 'invalid target price' };
    if (intent.side === 'BUY' && !(target > reference)) return { ok: false, reason: 'invalid BUY target geometry' };
    if (intent.side === 'SELL' && !(target < reference)) return { ok: false, reason: 'invalid SELL target geometry' };
  }

  return { ok: true };
}

function explicitSideFromText(rawText) {
  const text = String(rawText ?? '').toUpperCase();
  const buy = /\b(?:BUY|LONG)\b/.test(text);
  const sell = /\b(?:SELL|SHORT)\b/.test(text);
  if (buy === sell) return null;
  return buy ? 'BUY' : 'SELL';
}

function hasExplicitPendingEvidence(rawText, orderType) {
  if (orderType === 'MARKET') return true;
  const text = String(rawText ?? '').toUpperCase().replace(/[_-]+/g, ' ');
  if (orderType === 'LIMIT') {
    return /\b(?:BUY|SELL)\s+LIMIT\b/.test(text) || /\bLIMIT\s+(?:ORDER|ENTRY)\b/.test(text);
  }
  if (orderType === 'STOP') {
    return /\b(?:BUY|SELL)\s+STOP\b/.test(text) || /\bSTOP\s+(?:ORDER|ENTRY)\b/.test(text);
  }
  if (orderType === 'STOP_LIMIT') {
    return /\b(?:BUY|SELL)\s+STOP\s+LIMIT\b/.test(text) || /\bSTOP\s+LIMIT\b/.test(text);
  }
  return false;
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

function validateRawPriceEvidence(intent, rawText) {
  const required = executablePrices(intent);
  if (required.length === 0) return { ok: true };
  const evidenced = rawNumericEvidence(rawText);
  const missing = required.filter((price) => !evidenced.some((rawPrice) => approximatelyEqual(price, rawPrice)));
  if (missing.length > 0) {
    return { ok: false, reason: `AI raw price evidence failed for ${missing.join(', ')}` };
  }
  return { ok: true };
}

export function validateCanonicalSignalIntent(intent, { rawText = '' } = {}) {
  if (!intent || typeof intent !== 'object') return { ok: false, reason: 'signal intent required' };
  if (!['BUY', 'SELL'].includes(intent.side)) return { ok: false, reason: 'invalid side' };
  if (!intent.symbol?.canonical) return { ok: false, reason: 'canonical symbol required' };
  if (!EXECUTION_ORDER_TYPES.has(intent.orderType)) return { ok: false, reason: 'invalid order type' };
  if (intent.orderType !== 'MARKET' && intent.entry?.kind === 'MARKET') {
    return { ok: false, reason: 'pending order requires explicit entry' };
  }

  const geometry = validateGeometry(intent);
  if (!geometry.ok) return geometry;

  const explicitSide = explicitSideFromText(rawText);
  if (explicitSide && explicitSide !== intent.side) {
    return { ok: false, reason: `AI side conflicts with raw ${explicitSide} instruction` };
  }

  if (!hasExplicitPendingEvidence(rawText, intent.orderType)) {
    return { ok: false, reason: `AI pending order lacks raw ${intent.orderType} evidence` };
  }

  return validateRawPriceEvidence(intent, rawText);
}
