import { calculateRiskPlan } from '../risk/risk_engine.js';

function numberOrUndefined(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function text(value) {
  return String(value ?? '').trim();
}

function sizingMode(account = {}) {
  return text(account.sizingMode ?? account.sizing_mode).toUpperCase();
}

function configuredRiskPercent(account = {}, action = {}) {
  return numberOrUndefined(
    action.riskPercent ??
    action.risk_percent ??
    account.riskPercent ??
    account.risk_percent,
  );
}

function configuredRiskAmount(account = {}, action = {}) {
  return numberOrUndefined(
    action.riskAmount ??
    action.risk_amount ??
    account.riskAmount ??
    account.risk_amount,
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

function canonicalPolicyContext({ action, riskPercent, exposure }) {
  return {
    totalLots: Number(action.lots),
    riskPercent: numberOrUndefined(riskPercent) ?? 0,
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
  const plannedLots = assertPositiveLots(action);
  const mode = sizingMode(account);
  const riskPercent = configuredRiskPercent(account, action);

  if (!isRiskIncreasingOpen(action)) {
    return {
      allowed: true,
      action: { ...action, lots: plannedLots },
      policyContext: canonicalPolicyContext({ action: { ...action, lots: plannedLots }, riskPercent, exposure }),
      risk: null,
    };
  }

  // Fixed-lot OPENs are still subject to final account policy and strict broker
  // volume validation in platform translation. They do not invent a monetary
  // risk percentage when the account was not configured as risk-sized.
  if (mode !== 'RISK_PERCENT' && mode !== 'FIXED_RISK') {
    return {
      allowed: true,
      action: { ...action, lots: plannedLots },
      policyContext: canonicalPolicyContext({ action: { ...action, lots: plannedLots }, riskPercent, exposure }),
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
      riskPercent: mode === 'RISK_PERCENT' ? riskPercent : undefined,
      riskAmount: mode === 'FIXED_RISK' ? configuredRiskAmount(account, action) : undefined,
      entry,
      stopLoss,
      targetCount: 1,
      instrument,
    });
  } catch (error) {
    const wrapped = new Error(`broker risk context unavailable: ${error?.message || 'reliable loss model required'}`);
    wrapped.code = 'BROKER_RISK_CONTEXT_UNAVAILABLE';
    throw wrapped;
  }

  // The earlier plan may be smaller than the newly-authoritative broker result;
  // that is safe. It may never be larger. A later task may choose to resize
  // downward explicitly, but Task 3 intentionally preserves the planned amount
  // and blocks only unsafe over-sizing.
  const tolerance = Math.max(1e-12, Number(instrument.stepLots ?? 0.01) * 1e-9);
  if (plannedLots - risk.totalLots > tolerance) {
    const error = new RangeError('planned volume exceeds current broker-authoritative risk allowance');
    error.code = 'BROKER_RISK_EXCEEDED';
    throw error;
  }

  const finalAction = { ...action, lots: plannedLots };
  return {
    allowed: true,
    action: finalAction,
    policyContext: canonicalPolicyContext({ action: finalAction, riskPercent, exposure }),
    risk,
  };
}
