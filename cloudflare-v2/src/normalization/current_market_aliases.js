const CURRENT_MARKET_PATTERNS = [
  /\bC\s*\.\s*M\s*\.\s*P(?:\s*\.)?(?=\W|$)/gi,
  /\bCMP\b/gi,
  /\bCURRENT\s+MARKET\s+PRICE\b/gi,
  /\bCURRENT\s+MKT\s+PRICE\b/gi,
  /\bCURRENT\s+PRICE\b/gi,
  /\bMARKET\s+PRICE\b/gi,
  /\bAT\s+(?:THE\s+)?MARKET\b/gi,
  /\bCURRENT\s+MARKET\b/gi,
  /\bMKT\s+PRICE\b/gi,
];

function stripSeparatorDelimitedPresentationFooter(value) {
  const lines = String(value ?? '').replace(/\r/g, '').split('\n');
  const separatorIndex = lines.findIndex((line) => /^\s*(?:~{3,}|-{3,}|\*{3,}|_{3,}|={3,})\s*$/.test(line));
  if (separatorIndex <= 0) return String(value ?? '');
  return lines.slice(0, separatorIndex).join('\n').trimEnd();
}

export function normalizeCurrentMarketAliases(value) {
  const original = String(value ?? '');
  let normalized = original;
  for (const pattern of CURRENT_MARKET_PATTERNS) normalized = normalized.replace(pattern, ' NOW ');
  if (normalized === original) return original;
  normalized = stripSeparatorDelimitedPresentationFooter(normalized);
  return normalized.replace(/[ \t]+/g, ' ').trim();
}

export const currentMarketAliases = Object.freeze([
  'CMP',
  'C.M.P',
  'CURRENT MARKET PRICE',
  'CURRENT MKT PRICE',
  'CURRENT PRICE',
  'MARKET PRICE',
  'AT MARKET',
  'CURRENT MARKET',
  'MKT PRICE',
]);
