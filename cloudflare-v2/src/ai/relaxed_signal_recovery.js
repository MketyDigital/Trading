import { normalizeOrderIntent, normalizeSymbol } from '../normalization/trading_normalizer.js';
import { extractSignalNumbers, parseSignalNumber, SIGNAL_NUMBER_SOURCE } from '../normalization/signal_number.js';

const KNOWN_SYMBOL = /\b(GOLD|XAUUSD|XAU|SILVER|XAGUSD|XAG|BITCOIN|BTCUSD|BTC|ETHEREUM|ETHER|ETHUSD|ETH|US30|DOW|DJ30|NASDAQ100|NASDAQ|NAS100|US100|SP500|SPX500|US500|DAX40|DAX|GER40|FTSE100|FTSE|UK100|WTI|USOIL|BRENT|UKOIL)\b/i;

function parsedValue(raw) {
  const parsed = parseSignalNumber(raw);
  return parsed.ok ? parsed.value : null;
}

function explicitEntry(text) {
  const match = text.match(new RegExp(`\\b(?:ENTRY(?:\\s+(?:PRICE|ZONE))?|AROUND|NEAR|ABOUT|AT)\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'i'));
  return match ? parsedValue(match[1]) : null;
}

function explicitProtection(text) {
  const directional = text.match(new RegExp(`\\b(?:PROTECT|PROTECTION|STOP|SL|STOP\\s+LOSS|RISK)\\s+(UNDER|BELOW|ABOVE|OVER)\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'i'));
  if (directional) {
    const value = parsedValue(directional[2]);
    return value == null ? null : { direction: directional[1].toUpperCase(), value };
  }

  const labeled = text.match(new RegExp(`\\b(?:SL|STOP\\s+LOSS|RISK)\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'i'));
  if (!labeled) return null;
  const value = parsedValue(labeled[1]);
  return value == null ? null : { direction: null, value };
}

function explicitTargets(text) {
  const labeled = [];
  const numbered = new RegExp(`\\b(?:TP|TARGET|OBJECTIVE)\\s*([1-9]\\d?)\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'gi');
  for (const match of text.matchAll(numbered)) {
    const value = parsedValue(match[2]);
    if (value == null) return null;
    labeled.push({ index: Number(match[1] || labeled.length + 1), value });
  }
  if (labeled.length) {
    const unique = new Map(labeled.map((item) => [item.index, item.value]));
    return [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  }

  const match = text.match(/\b(?:AIM(?:ING)?(?:\s+FOR)?|OBJECTIVE(?:S)?|TARGET(?:S|ING)?(?:\s+AT)?|TAKE\s+PROFITS?(?:\s+AT)?|TP)\s*[:=@-]?\s+(.+)$/i);
  if (!match) return [];
  const tokens = extractSignalNumbers(match[1]);
  if (tokens.some((token) => !token.ok)) return null;
  return tokens.map((token) => token.value);
}

function hasAmbiguousGroupedNumber(text) {
  const candidates = String(text ?? '').match(/-?\d(?:[\d,]*\d)?(?:\.\d+)?/g) || [];
  return candidates.some((candidate) => candidate.includes(',') && !parseSignalNumber(candidate).ok);
}

function geometryValid(intent, protectionDirection = null) {
  const entry = intent.entry.value;
  if (intent.side === 'BUY') {
    if (protectionDirection && !['UNDER', 'BELOW'].includes(protectionDirection)) return false;
    if (!(intent.stopLoss < entry)) return false;
    return intent.takeProfits.every((target) => target > entry);
  }
  if (protectionDirection && !['ABOVE', 'OVER'].includes(protectionDirection)) return false;
  if (!(intent.stopLoss > entry)) return false;
  return intent.takeProfits.every((target) => target < entry);
}

function buildRecoveredIntent(text) {
  if (!text || hasAmbiguousGroupedNumber(text)) return null;

  const order = normalizeOrderIntent(text);
  if (!order.side) return null;

  const symbolMatch = text.match(KNOWN_SYMBOL);
  if (!symbolMatch) return null;

  const entry = explicitEntry(text);
  const protection = explicitProtection(text);
  const takeProfits = explicitTargets(text);
  if (!Number.isFinite(entry) || !protection || !Number.isFinite(protection.value) || !Array.isArray(takeProfits) || takeProfits.length === 0) return null;
  if (!takeProfits.every(Number.isFinite)) return null;

  const intent = {
    side: order.side,
    orderType: order.orderType,
    symbol: normalizeSymbol(symbolMatch[1]),
    entry: { kind: 'PRICE', value: entry },
    stopLoss: protection.value,
    takeProfits,
    fastEntry: false,
    incomplete: false,
  };

  return geometryValid(intent, protection.direction) ? intent : null;
}

export function recoverKnownNaturalLanguageSignal(textValue) {
  return buildRecoveredIntent(String(textValue ?? '').trim());
}

export function recoverMaterialSignalFallback(textValue) {
  const text = String(textValue ?? '').trim();
  if (!text) return null;
  return buildRecoveredIntent(text);
}
