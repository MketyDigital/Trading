import { normalizeOrderIntent, normalizeSymbol } from '../normalization/trading_normalizer.js';
import { extractSignalNumbers, parseSignalNumber, SIGNAL_NUMBER_SOURCE } from '../normalization/signal_number.js';

const KNOWN_SYMBOL = /\b(GOLD|XAUUSD|XAU|SILVER|XAGUSD|XAG|BITCOIN|BTCUSD|BTC|ETHEREUM|ETHER|ETHUSD|ETH|US30|DOW|DJ30|NASDAQ100|NASDAQ|NAS100|US100|SP500|SPX500|US500|DAX40|DAX|GER40|FTSE100|FTSE|UK100|WTI|USOIL|BRENT|UKOIL)\b/i;

function parsedValue(raw) {
  const parsed = parseSignalNumber(raw);
  return parsed.ok ? parsed.value : null;
}

function hasAmbiguousGroupedNumber(text) {
  const candidates = String(text ?? '').match(/-?\d(?:[\d,]*\d)?(?:\.\d+)?/g) || [];
  return candidates.some((candidate) => candidate.includes(',') && !parseSignalNumber(candidate).ok);
}

function valuesFromTail(tail) {
  const tokens = extractSignalNumbers(tail);
  if (tokens.some((token) => !token.ok)) return null;
  return tokens.map((token) => token.value);
}

function geometryValid(intent, protectionDirection = null) {
  const entry = intent.entry.value;
  if (intent.side === 'BUY') {
    if (protectionDirection && !['UNDER', 'BELOW'].includes(protectionDirection)) return false;
    return intent.stopLoss < entry && intent.takeProfits.every((target) => target > entry);
  }
  if (protectionDirection && !['ABOVE', 'OVER'].includes(protectionDirection)) return false;
  return intent.stopLoss > entry && intent.takeProfits.every((target) => target < entry);
}

function makeIntent(text, { entry, protection, takeProfits }) {
  if (!text || hasAmbiguousGroupedNumber(text)) return null;
  const order = normalizeOrderIntent(text);
  const symbolMatch = text.match(KNOWN_SYMBOL);
  if (!order.side || !symbolMatch || !Number.isFinite(entry) || !protection || !Number.isFinite(protection.value)) return null;
  if (!Array.isArray(takeProfits) || takeProfits.length === 0 || !takeProfits.every(Number.isFinite)) return null;

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

function strictRecovery(text) {
  const entryMatch = text.match(new RegExp(`\\b(?:AROUND|NEAR|ABOUT|AT)\\s+(${SIGNAL_NUMBER_SOURCE})`, 'i'));
  const protectionMatch = text.match(new RegExp(`\\b(?:PROTECT|PROTECTION|STOP)\\s+(UNDER|BELOW|ABOVE|OVER)\\s+(${SIGNAL_NUMBER_SOURCE})`, 'i'));
  const targetMatch = text.match(/\b(?:AIM(?:ING)?(?:\s+FOR)?|TARGET(?:S|ING)?(?:\s+AT)?|TAKE\s+PROFITS?(?:\s+AT)?)\s+(.+)$/i);
  if (!entryMatch || !protectionMatch || !targetMatch) return null;
  const takeProfits = valuesFromTail(targetMatch[1]);
  const value = parsedValue(protectionMatch[2]);
  return makeIntent(text, {
    entry: parsedValue(entryMatch[1]),
    protection: value == null ? null : { direction: protectionMatch[1].toUpperCase(), value },
    takeProfits,
  });
}

function fallbackRecovery(text) {
  const entryMatch = text.match(new RegExp(`\\bENTRY(?:\\s+(?:PRICE|ZONE))?\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'i'));
  const protectionMatch = text.match(new RegExp(`\\b(?:SL|STOP\\s+LOSS|RISK)\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'i'));
  if (!entryMatch || !protectionMatch) return null;

  const numbered = [];
  const numberedPattern = new RegExp(`\\b(?:TP|TARGET|OBJECTIVE)\\s*([1-9]\\d?)\\s*[:=@-]?\\s*(${SIGNAL_NUMBER_SOURCE})`, 'gi');
  for (const match of text.matchAll(numberedPattern)) {
    const value = parsedValue(match[2]);
    if (value == null) return null;
    numbered.push({ index: Number(match[1] || numbered.length + 1), value });
  }

  let takeProfits;
  if (numbered.length) {
    const unique = new Map(numbered.map((item) => [item.index, item.value]));
    takeProfits = [...unique.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
  } else {
    const tailMatch = text.match(/\b(?:OBJECTIVE(?:S)?|TARGETS?|TPS?)\s*[:=@-]?\s+(.+)$/i);
    takeProfits = tailMatch ? valuesFromTail(tailMatch[1]) : [];
  }

  const stop = parsedValue(protectionMatch[1]);
  return makeIntent(text, {
    entry: parsedValue(entryMatch[1]),
    protection: stop == null ? null : { direction: null, value: stop },
    takeProfits,
  });
}

export function recoverKnownNaturalLanguageSignal(textValue) {
  return strictRecovery(String(textValue ?? '').trim());
}

export function recoverMaterialSignalFallback(textValue) {
  return fallbackRecovery(String(textValue ?? '').trim());
}
