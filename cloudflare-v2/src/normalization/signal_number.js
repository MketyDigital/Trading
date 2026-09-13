function success(raw, normalized, repairReason = null) {
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ok: false, raw, reason: 'AMBIGUOUS_NUMBER', confidence: 'REVIEW' };
  }
  return {
    ok: true,
    value,
    raw,
    normalized,
    confidence: 'HIGH',
    repairReason,
  };
}

function failure(raw, reason = 'AMBIGUOUS_NUMBER') {
  return { ok: false, raw, reason, confidence: 'REVIEW' };
}

function normalizedSource(raw) {
  return String(raw ?? '').trim().replace(/\u00a0/g, ' ');
}

function signAndBody(source, allowNegative) {
  const negative = source.startsWith('-');
  if (negative && !allowNegative) return null;
  const body = negative || source.startsWith('+') ? source.slice(1) : source;
  if (!body) return null;
  return { sign: negative ? '-' : '', body };
}

function isPlain(body) {
  return /^\d+(?:\.\d+)?$/.test(body);
}

function isCommaGrouped(body) {
  return /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(body);
}

function isSpaceGrouped(body) {
  return /^\d{1,3}(?: \d{3})+(?:\.\d+)?$/.test(body);
}

function repairDuplicatedDecimalSeparator(body) {
  if (body.includes('.') || body.includes(' ')) return null;
  const parts = body.split(',');
  if (parts.length < 3) return null;

  const decimal = parts.at(-1);
  const integerGroups = parts.slice(0, -1);
  if (!/^\d{1,2}$/.test(decimal)) return null;
  if (!/^\d{1,3}$/.test(integerGroups[0] || '')) return null;
  if (!integerGroups.slice(1).every((group) => /^\d{3}$/.test(group))) return null;

  return `${integerGroups.join('')}.${decimal}`;
}

export function parseSignalNumber(rawValue, { allowNegative = false } = {}) {
  const raw = normalizedSource(rawValue);
  if (!raw) return failure(raw, 'NUMBER_REQUIRED');

  const signed = signAndBody(raw, allowNegative);
  if (!signed) return failure(raw, raw.startsWith('-') ? 'NEGATIVE_NUMBER_NOT_ALLOWED' : 'AMBIGUOUS_NUMBER');
  const { sign, body } = signed;

  if (isPlain(body)) return success(raw, `${sign}${body}`);
  if (isCommaGrouped(body)) return success(raw, `${sign}${body.replaceAll(',', '')}`);
  if (isSpaceGrouped(body)) return success(raw, `${sign}${body.replaceAll(' ', '')}`);

  const repaired = repairDuplicatedDecimalSeparator(body);
  if (repaired) {
    return success(raw, `${sign}${repaired}`, 'DUPLICATE_DECIMAL_SEPARATOR');
  }

  return failure(raw);
}

// This scanner is intentionally conservative. It recognizes complete numeric
// tokens used in trading signals without splitting thousands-grouped prices
// into fragments. Parsing/validation remains authoritative in parseSignalNumber.
const SIGNAL_NUMBER_TOKEN = /-?(?:\d{1,3}(?:,\d{3})+(?:,\d{1,2}|\.\d+)?|\d{1,3}(?: \d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;

export function extractSignalNumbers(textValue, options = {}) {
  const text = String(textValue ?? '');
  const matches = text.match(SIGNAL_NUMBER_TOKEN) || [];
  return matches.map((raw) => parseSignalNumber(raw, options));
}

export { SIGNAL_NUMBER_TOKEN };
