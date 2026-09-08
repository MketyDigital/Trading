const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export function destinationEntitlementForType(type) {
  const normalized = String(type ?? '').trim().toLowerCase();
  if (normalized === 'telegram') return 'telegramDestination';
  if (['broker_account', 'internal_webhook', 'trading_execution'].includes(normalized)) {
    return 'tradingExecutionDestination';
  }
  return null;
}

function strings(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => String(value).trim()).filter(Boolean))];
}

export function normalizeTradingEntitlements(input = {}) {
  const destinations = strings(input.destinations);
  const inferredTradingDestination = destinations.some(
    (type) => destinationEntitlementForType(type) === 'tradingExecutionDestination',
  );
  const inferredTelegramDestination = destinations.some(
    (type) => destinationEntitlementForType(type) === 'telegramDestination',
  );

  const requestedBrokerModes = strings(input.brokerModes, ['demo']);
  const brokerModes = requestedBrokerModes.some((mode) => mode.toLowerCase() === 'demo') ? ['demo'] : ['demo'];

  return {
    customSubdomain: Boolean(input.customSubdomain),
    customHostname: Boolean(input.customHostname),
    tradingExecutionDestination: hasOwn(input, 'tradingExecutionDestination')
      ? Boolean(input.tradingExecutionDestination)
      : inferredTradingDestination,
    telegramDestination: hasOwn(input, 'telegramDestination')
      ? Boolean(input.telegramDestination)
      : inferredTelegramDestination,
    sourceTypes: strings(input.sourceTypes),
    brokerModes,
    liveExecution: false,
    maxTeamMembers: Math.max(1, Number.parseInt(input.maxTeamMembers ?? 1, 10) || 1),
    destinations,
  };
}

export function entitlementsFromTradingAuth(auth = {}) {
  return normalizeTradingEntitlements(
    auth?.workspace?.metadata?.entitlements
      ?? auth?.entitlements
      ?? {},
  );
}

export function hasTradingEntitlement(auth, entitlement) {
  return Boolean(entitlementsFromTradingAuth(auth)[entitlement]);
}
