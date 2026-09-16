function text(value) {
  return String(value ?? '').trim();
}

function destinationType(destination = {}) {
  return text(destination.destination_type ?? destination.destinationType ?? destination.type).toLowerCase();
}

function canonicalSymbol(interpretation = {}) {
  const intent = interpretation?.intent && typeof interpretation.intent === 'object' ? interpretation.intent : {};
  const symbol = intent?.symbol && typeof intent.symbol === 'object' ? intent.symbol : {};
  return text(
    symbol.canonical
    ?? symbol.canonicalSymbol
    ?? symbol.canonical_symbol
    ?? intent.canonicalSymbol
    ?? intent.canonical_symbol
    ?? intent.symbolCanonical
    ?? intent.symbol_canonical
    ?? interpretation.canonicalSymbol
    ?? interpretation.canonical_symbol,
  ).toUpperCase();
}

function normalizedList(value) {
  if (value === undefined || value === null) return { ok: true, values: [] };
  if (!Array.isArray(value)) return { ok: false, values: [] };
  const values = [...new Set(value.map((item) => text(item).toUpperCase()).filter(Boolean))];
  return { ok: true, values };
}

export function evaluateRouteFilters(filters, interpretation, destination = {}) {
  if (filters === undefined || filters === null) return { allowed: true, reason: null };
  if (typeof filters !== 'object' || Array.isArray(filters)) {
    return destinationType(destination) === 'broker_account'
      ? { allowed: false, reason: 'ROUTE_FILTERS_INVALID' }
      : { allowed: true, reason: null };
  }

  const allowed = normalizedList(filters.allowedCanonicalSymbols ?? filters.allowed_canonical_symbols);
  const blocked = normalizedList(filters.blockedCanonicalSymbols ?? filters.blocked_canonical_symbols);
  if (!allowed.ok || !blocked.ok) {
    return destinationType(destination) === 'broker_account'
      ? { allowed: false, reason: 'ROUTE_FILTERS_INVALID' }
      : { allowed: true, reason: null };
  }

  if (!allowed.values.length && !blocked.values.length) return { allowed: true, reason: null };

  const symbol = canonicalSymbol(interpretation);
  if (!symbol) {
    return destinationType(destination) === 'broker_account'
      ? { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_UNAVAILABLE' }
      : { allowed: true, reason: null };
  }

  if (blocked.values.includes(symbol)) return { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_BLOCKED' };
  if (allowed.values.length && !allowed.values.includes(symbol)) {
    return { allowed: false, reason: 'ROUTE_FILTER_SYMBOL_NOT_ALLOWED' };
  }
  return { allowed: true, reason: null };
}
