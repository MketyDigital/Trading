import { calculateRiskPlan } from '../risk/risk_engine.js';

function numberOrUndefined(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function text(value) {
  return String(value ?? '').trim();
}

function sizingMode(account = {}) {
  return text(account.sizingMode ?? account.sizing_mode ?? account.lot_sizing_type).toUpperCase();
}

function configuredRiskPercent(account = {}, action = {}) {
  const mode = sizingMode(account);
  return numberOrUndefined(
    action.riskPercent ??
    action.risk_percent ??
    account.riskPercent ??
    account.risk_percent ??
    (['RISK_PERCENT', 'EQUITY_RISK_PERCENT', 'BALANCE_RISK_PERCENT'].includes(mode) ? account.lot_value : undefined),
  );
}

function configuredRiskAmount(account = {}, action = {}) {
  return numberOrUndefined(
    action.riskAmount ??
    action.risk_amount ??
    account.riskAmount ??
    account.risk_amount ??
    (sizingMode(account) === 'FIXED_RISK' ? account.lot_value ?? account.lotValue : undefined),
  );
}

function entryPrice(action = {}, currentMarketPrice) {
  if (action?.entry?.kind === 'PRICE') return numberOrUndefined(action.entry.value);
  if (numberOrUndefined(action.entryPrice) != null) return numberOrUndefined(action.entryPrice);
  return numberOrUndefined(currentMarketPrice);
}

function brokerEquity(account = {}) {
  return numberOrUndefined(account.equity ?? account.account?.equity);
}

function brokerBalance(account = {}) {
  return numberOrUndefined(account.balance ?? account.account?.balance);
}

function exposureValue(exposure = {}, name) {
  return numberOrUndefined(exposure?.[name]) ?? 0;
}

function canonicalPolicyContext({ action, riskPercent, exposure, minimumVolumeRiskOveragePercent = 0 }) {
  const lots = numberOrUndefined(action?.lots);
  const overage = numberOrUndefined(minimumVolumeRiskOveragePercent);
  return {
    totalLots: lots != null ? lots : 0,
    riskPercent: numberOrUndefined(riskPercent) ?? 0,
    // Nonzero only for broker minimum-volume floors; ordinary risk overruns
    // remain subject to strict account policy.
    minimumVolumeRiskOveragePercent: overage != null && overage > 0 ? overage : 0,
    currentDailyPnlPercent: exposureValue(exposure, 'currentDailyPnlPercent'),
    currentOpenRiskPercent: exposureValue(exposure, 'currentOpenRiskPercent'),
  };
}

function assertPositiveLots(action = {}) {
  const lots = Number(action.lots);
  if (!Number.isFinite(lots) || lots <= 0) throw new TypeError('production action lots must be positive');
  return lots;
}

function isRiskIncreasingOpen(action = {}) {
  return text(action.type).toUpperCase() === 'OPEN_POSITION';
}

function normalizedReduceRiskAction(action = {}) {
  const actionType = text(action.type).toUpperCase();
  const lots = numberOrUndefined(action.lots);
  if (actionType === 'CLOSE_PARTIAL' && !(lots > 0)) {
    throw new TypeError('production partial-close lots must be positive');
  }
  const safeAction = { ...action };
  delete safeAction.minimumVolumeFallbackAuthorized;
  return lots != null ? { ...safeAction, lots } : { ...safeAction };
}

/**
 * Revalidates one production action against current broker account/symbol
 * economics immediately before broker dispatch. Planning remains useful intent,
 * but it is never allowed to authorize a larger live position than the current
 * broker facts permit.
 */
export function validateProductionRiskAction({
  account = {},
  action = {},
  brokerAccount = {},
  instrument = {},
  currentMarketPrice,
  exposure = {},
} = {}) {
  const mode = sizingMode(account);
  const riskPercent = configuredRiskPercent(account, action);

  if (!isRiskIncreasingOpen(action)) {
    const finalAction = normalizedReduceRiskAction(action);
    return {
      allowed: true,
      action: finalAction,
      policyContext: canonicalPolicyContext({ action: finalAction, riskPercent, exposure }),
      risk: null,
    };
  }

  const plannedLots = assertPositiveLots(action);

  // Fixed-lot OPENs are still subject to final account policy and strict broker
  // volume validation in platform translation. They do not invent a monetary
  // risk percentage when the account was not configured as risk-sized.
  const explicitRiskAmount = configuredRiskAmount(account, action);
  const riskAmountOverridesPercent = explicitRiskAmount != null && explicitRiskAmount > 0;
  if (!riskAmountOverridesPercent && !['RISK_PERCENT', 'EQUITY_RISK_PERCENT', 'BALANCE_RISK_PERCENT', 'FIXED_RISK'].includes(mode)) {
    const safeAction = { ...action };
    delete safeAction.minimumVolumeFallbackAuthorized;
    return {
      allowed: true,
      action: { ...safeAction, lots: plannedLots },
      policyContext: canonicalPolicyContext({ action: { ...safeAction, lots: plannedLots }, riskPercent, exposure }),
      risk: null,
    };
  }

  const entry = entryPrice(action, currentMarketPrice);
  const stopLoss = numberOrUndefined(action.stopLoss);
  if (!(entry > 0) || !(stopLoss > 0) || entry === stopLoss) {
    throw new Error('broker risk context requires reliable entry and stop loss');
  }

  let risk;
  try {
    risk = calculateRiskPlan({
      equity: brokerEquity(brokerAccount),
      balance: brokerBalance(brokerAccount),
      riskPercent: ['RISK_PERCENT', 'EQUITY_RISK_PERCENT', 'BALANCE_RISK_PERCENT'].includes(mode) ? riskPercent : undefined,
      riskAmount: riskAmountOverridesPercent || mode === 'FIXED_RISK' ? explicitRiskAmount : undefined,
      riskBasis: mode === 'BALANCE_RISK_PERCENT' ? 'BALANCE' : (account.riskBasis ?? account.risk_basis ?? account.lot_sizing_config?.riskBasis ?? account.lot_sizing_config?.risk_basis ?? (brokerEquity(brokerAccount) != null ? 'EQUITY' : 'BALANCE')),
      entry,
      minimumLotPolicy: account.safetyPolicy?.minimumLotPolicy ?? account.safety_policy?.minimumLotPolicy ?? 'FLOOR',
      stopLoss,
      targetCount: 1,
      instrument,
    });
  } catch (error) {
    const wrapped = new Error(`broker risk context unavailable: ${error?.message || 'reliable loss model required'}`);
    wrapped.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw wrapped;
  }

  // Broker-authoritative sizing is the final lot materializer. Upstream lots
  // can be stale or calculated with incomplete broker constraints; resize this
  // valid OPEN to the current executable risk-sized volume rather than rejecting
  // it solely because the earlier plan differs.
  const safeAction = { ...action };
  delete safeAction.minimumVolumeFallbackAuthorized;
  const finalAction = {
    ...safeAction,
    lots: risk.lotsPerLeg,
    // This capability is minted only by broker-authoritative risk sizing.
    // The coordinator still must pass account policy before any dispatch.
    ...(risk.minimumFloorApplied === true ? { minimumVolumeFallbackAuthorized: true } : {}),
  };
  const riskBasisAmount = String(risk.riskBasis || 'EQUITY').toUpperCase() === 'BALANCE'
    ? brokerBalance(brokerAccount)
    : brokerEquity(brokerAccount);
  if (!(riskBasisAmount > 0)) {
    const error = new Error('broker risk context unavailable: positive risk-basis equity or balance is required');
    error.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw error;
  }
  const actualRiskPercent = riskBasisAmount > 0
    ? (Number(risk.estimatedRiskExact ?? risk.estimatedRisk) / riskBasisAmount) * 100
    : Number.POSITIVE_INFINITY;
  // Compare the broker minimum against the actual configured monetary budget.
  // This also handles FIXED_RISK and riskAmount overrides, where riskPercent
  // may be absent or unrelated to the requested cash risk.
  const requestedRiskPercent = riskBasisAmount > 0
    ? (Number(risk.riskAmountExact ?? risk.riskAmount) / riskBasisAmount) * 100
    : 0;
  const minimumVolumeRiskOveragePercent = risk.minimumFloorApplied === true
    ? Math.max(0, actualRiskPercent - requestedRiskPercent)
    : 0;
  return {
    allowed: true,
    action: finalAction,
    policyContext: canonicalPolicyContext({
      action: finalAction,
      riskPercent: actualRiskPercent,
      exposure,
      minimumVolumeRiskOveragePercent,
    }),
    risk,
  };
}
