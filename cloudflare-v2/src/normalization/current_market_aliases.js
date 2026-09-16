const CURRENT_MARKET_PATTERNS = [
  /\bC\s*\.\s*M\s*\.\s*P\s*\.?\b/gi,
  /\bCMP\b/gi,
  /\bCURRENT\s+MARKET\s+PRICE\b/gi,
  /\bCURRENT\s+MKT\s+PRICE\b/gi,
  /\bCURRENT\s+PRICE\b/gi,
  /\bMARKET\s+PRICE\b/gi,
  /\bAT\s+(?:THE\s+)?MARKET\b/gi,
  /\bCURRENT\s+MARKET\b/gi,
  /\bMKT\s+PRICE\b/gi,
];

export function normalizeCurrentMarketAliases(value) {
  let text = String(value ?? '');
  for (const pattern of CURRENT_MARKET_PATTERNS) text = text.replace(pattern, ' NOW ');
  return text.replace(/[ \t]+/g, ' ').trim();
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
