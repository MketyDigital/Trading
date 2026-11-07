function text(value) {
  return String(value ?? '').trim();
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

const UPDATE_EVENT_TYPES = new Set(['TP_HIT', 'SL_HIT', 'WEEKLY_ROUNDUP']);

function normalizedKind(value) {
  return text(value).toUpperCase().replace(/[\s-]+/g, '_');
}

/**
 * Resolve only well-sourced broker lifecycle confirmations or unmistakable
 * weekly roundup posts. Unknown commentary is not treated as a notification.
 */
export function classifyUpdateEvent(interpretation = {}, event = {}) {
  interpretation = safeObject(interpretation);
  event = safeObject(event);
  const management = safeObject(interpretation.management);
  const metadata = safeObject(event.metadata);
  const payload = safeObject(event.structured_payload ?? event.structuredPayload);
  const brokerFill = safeObject(metadata.broker_fill ?? metadata.brokerFill);
  const brokerActivity = safeObject(metadata.broker_activity ?? metadata.brokerActivity);

  const managementType = normalizedKind(management.type ?? management.action);
  const brokerFillKind = normalizedKind(brokerFill.kind);
  const brokerActivityKind = normalizedKind(brokerActivity.kind ?? payload.activityKind ?? payload.activity_kind);
  const payloadKind = normalizedKind(payload.kind);
  const status = normalizedKind(interpretation.status ?? event.processing_status ?? event.processingStatus);
  const hasTradeIntent = Boolean(interpretation.intent && typeof interpretation.intent === 'object');

  // A route configured to receive notifications must never accept an event
  // that carries a trade intent, needs review, or is in a trade-action state,
  // even when accompanying metadata/text mentions a TP/SL hit.
  if (hasTradeIntent || status === 'NEEDS_REVIEW') return null;
  const tradeActionStatuses = new Set([
    'READY', 'FAST_ENTRY', 'SIGNAL_COMPLETION', 'ENTRY_UPDATE', 'SL_UPDATE',
    'TP_UPDATE', 'ADD_POSITION', 'REDUCE_POSITION', 'MOVE_SL_TO_BE', 'MOVE_SL',
    'TRAIL_STOP', 'CLOSE', 'CLOSE_PARTIAL', 'CLOSE_ALL', 'CANCEL', 'CANCEL_PENDING',
    'PENDING_ORDER', 'PENDING_ORDER_UPDATE',
  ]);
  if (tradeActionStatuses.has(status)) return null;

  if (['TP_HIT', 'TAKE_PROFIT_HIT', 'TARGET_HIT'].includes(managementType)
    || (status === 'MANAGEMENT' && ['TAKE_PROFIT', 'TP'].includes(brokerFillKind))
    || ['TAKE_PROFIT', 'TP', 'PARTIAL_TAKE_PROFIT', 'PARTIAL_TP'].includes(brokerActivityKind)
    || (status === 'MANAGEMENT' && payloadKind === 'BROKER_TP_FILL')) return 'TP_HIT';

  if (['SL_HIT', 'STOP_LOSS_HIT'].includes(managementType)
    || ['STOP_LOSS', 'SL', 'PARTIAL_STOP_LOSS', 'PARTIAL_SL'].includes(brokerActivityKind)
    || ['STOP_LOSS_HIT', 'SL_HIT'].includes(payloadKind)) return 'SL_HIT';

  // MANAGEMENT is the only canonical status that can qualify as a TP/SL
  // notification, and only via the explicit lifecycle fields checked above.
  if (status === 'MANAGEMENT') return null;

  const explicitKind = normalizedKind(
    payload.kind
    ?? metadata.deliveryCategory
    ?? metadata.delivery_category
    ?? metadata.routeCategory
    ?? metadata.route_category
    ?? metadata.eventType
    ?? metadata.event_type,
  );
  if (['WEEKLY_ROUNDUP', 'WEEKLY_RECAP', 'WEEKLY_SUMMARY'].includes(explicitKind)) return 'WEEKLY_ROUNDUP';

  const rawText = text(event.text ?? event.raw_text ?? event.rawText);
  const hasWeeklyHeading = /(?:^|\n)\s*(?:📊|🗓️|📰)?\s*(?:starpips\s+)?weekly\s+(?:round[ -]?up|recap|summary)\b/i.test(rawText);
  return hasWeeklyHeading ? 'WEEKLY_ROUNDUP' : null;
}

function updateOnlyDecision(destination, interpretation, event) {
  const template = safeObject(destination?.template);
  const layout = safeObject(template.layout);
  const policy = safeObject(layout.deliveryPolicy ?? layout.delivery_policy);
  const mode = normalizedKind(policy.mode ?? policy.type);
  if (mode !== 'UPDATES_ONLY') return null;

  if (destinationType(destination) !== 'telegram') {
    return { allowed: false, reason: 'ROUTE_UPDATE_TEMPLATE_TELEGRAM_ONLY' };
  }

  const allowed = normalizedList(policy.allowedEvents ?? policy.allowed_events);
  if (!allowed.ok || allowed.values.length === 0
    || allowed.values.some((item) => !UPDATE_EVENT_TYPES.has(item))) {
    return { allowed: false, reason: 'ROUTE_UPDATE_TEMPLATE_INVALID' };
  }

  const eventType = classifyUpdateEvent(interpretation, event);
  if (!eventType || !allowed.values.includes(eventType)) {
    return { allowed: false, reason: 'ROUTE_UPDATE_EVENT_NOT_ALLOWED' };
  }
  return null;
}

export function evaluateRouteFilters(filters, interpretation, destination = {}, event = {}) {
  const updateOnly = updateOnlyDecision(destination, interpretation, event);
  if (updateOnly) return updateOnly;

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
