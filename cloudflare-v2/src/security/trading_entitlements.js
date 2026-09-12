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
    brokerModes: ['demo'],
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

export function isAccessCodeProvisionedWorkspace(auth = {}) {
  return Boolean(auth?.workspace?.metadata?.accessCodeProvisioned);
}

export function hasTradingEntitlement(auth, entitlement) {
  return Boolean(entitlementsFromTradingAuth(auth)[entitlement]);
}

export function requiresTradingEntitlement(auth, entitlement) {
  return isAccessCodeProvisionedWorkspace(auth) && !hasTradingEntitlement(auth, entitlement);
}

export function canUseDestinationType(auth, type) {
  const entitlement = destinationEntitlementForType(type);
  return !entitlement || !requiresTradingEntitlement(auth, entitlement);
}

export function canUseSourceProvider(auth, { sourceFamily, providerType } = {}) {
  if (!isAccessCodeProvisionedWorkspace(auth)) return true;
  const allowed = new Set(entitlementsFromTradingAuth(auth).sourceTypes.map((value) => String(value).trim().toLowerCase()));
  if (allowed.size === 0) return false;
  const family = String(sourceFamily ?? '').trim().toLowerCase();
  const provider = String(providerType ?? '').trim().toLowerCase();
  if (provider && allowed.has(provider)) return true;
  if (family && allowed.has(family)) return true;
  // Historical access codes used friendly family aliases while newer test/provisioning
  // paths can store exact provider identifiers. Keep both forms compatible.
  if (family === 'telegram' && allowed.has('mtproto')) return true;
  if (family === 'tradingview' && allowed.has('tradingview_webhook')) return true;
  return false;
}
