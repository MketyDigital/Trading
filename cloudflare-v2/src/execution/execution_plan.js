import { calculateRiskPlan } from '../risk/risk_engine.js';
import { buildPositionGroup } from './position_group.js';
import { evaluateAccountPolicy } from './account_policy.js';
import { applyProtectionPolicy } from './protection_validation_policy.js';
import { materializeExecutionEntry } from './entry_materializer.js';

function decimals(step) {
  const numeric = Number(step ?? 0.01);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const [coefficient, exponentText] = String(numeric).toLowerCase().split('e');
  const fractionDigits = coefficient.includes('.')
    ? coefficient.split('.')[1].length
    : 0;
  const exponent = exponentText == null ? 0 : Number(exponentText);
  return Math.max(0, fractionDigits - exponent);
}

function policyMode(value, fallback) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.mode : value;
  const normalized = String(raw ?? '').trim().toUpperCase();
  return normalized || fallback;
}

function entryZoneRangeMode(account = {}) {
  const mode = policyMode(account.entryZonePolicy ?? account.entry_zone_policy, 'MARKET_IF_IN_RANGE');
  if (['MARKET_IF_IN_RANGE', 'MARKET_IF_INSIDE', 'NEAREST_BOUNDARY'].includes(mode)) return 'MARKET_IF_IN_RANGE';
  if (['MARKET_ALWAYS', 'MARKET_ONLY'].includes(mode)) return 'MARKET_ALWAYS';
  if (['MIDPOINT', 'LOWER', 'UPPER'].includes(mode)) return mode;
  return 'MARKET_IF_IN_RANGE';
}

function applyEntryZonePolicy(intent, account, currentMarketPrice) {
  const declaredOrderType = String(intent?.orderType || 'MARKET').trim().toUpperCase();
  const pendingOrder = ['LIMIT', 'STOP', 'STOP_LIMIT'].includes(declaredOrderType);
  if (pendingOrder && intent?.entry?.kind !== 'RANGE') return intent;

  const configuredMode = policyMode(account.entryZonePolicy ?? account.entry_zone_policy, 'MARKET_IF_IN_RANGE');
  if (!pendingOrder && configuredMode === 'MARKET_ONLY') {
    const price = Number(currentMarketPrice);
    return {
      ...intent,
      orderType: 'MARKET',
      entry: Number.isFinite(price) && price > 0
        ? { kind: 'MARKET', referencePrice: price }
        : { kind: 'MARKET' },
    };
  }

  if (intent?.entry?.kind !== 'RANGE') return intent;
  const price = Number(currentMarketPrice);
  if (!(Number.isFinite(price) && price > 0)) return intent;
  const materialized = materializeExecutionEntry(intent, {
    currentPrice: price,
    rangeMode: entryZoneRangeMode(account),
  });
  return { ...intent, orderType: materialized.orderType, entry: materialized.entry };
}

function resolveRiskEntry(intent, currentMarketPrice) {
  const entry = intent?.entry;
  if (entry?.kind === 'PRICE' && Number.isFinite(Number(entry.value))) return Number(entry.value);
  if (entry?.kind === 'RANGE' && Number.isFinite(Number(entry.min)) && Number.isFinite(Number(entry.max))) {
    return intent.side === 'SELL' ? Number(entry.min) : Number(entry.max);
  }
  if (Number.isFinite(Number(currentMarketPrice)) && Number(currentMarketPrice) > 0) return Number(currentMarketPrice);
  throw new Error('current market price is required for market risk sizing');
}

function logicalProtectionEntry(intent, currentMarketPrice, protectionReferencePrice) {
  const entry = intent?.entry;
  if (entry?.kind === 'PRICE' && Number.isFinite(Number(entry.value)) && Number(entry.value) > 0) return Number(entry.value);
  if (entry?.kind === 'RANGE' && Number.isFinite(Number(entry.min)) && Number(entry.min) > 0
    && Number.isFinite(Number(entry.max)) && Number(entry.max) > 0) {
    return intent.side === 'SELL' ? Number(entry.min) : Number(entry.max);
  }
  for (const candidate of [protectionReferencePrice, currentMarketPrice]) {
    const price = Number(candidate);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return null;
}

function validLogicalTarget(side, target, entry) {
  const level = Number(target);
  if (!Number.isFinite(level) || level <= 0) return false;
  if (!(Number.isFinite(Number(entry)) && Number(entry) > 0)) return true;
  return side === 'BUY' ? level > Number(entry) : level < Number(entry);
}

function normalizeFixedLots(value, instrument) {
  const lots = Number(value);
  const step = Number(instrument?.stepLots ?? 0.01);
  const min = Number(instrument?.minLots ?? step);
  const max = Number(instrument?.maxLots ?? Number.POSITIVE_INFINITY);
  if (!(lots > 0) || !(step > 0) || !(min > 0) || !(max >= min)) throw new TypeError('valid fixed lots and volume constraints required');

  // A fixed-lot preference is user-facing intent; the broker catalog is the
  // execution authority. Materialize the nearest executable size without
  // rejecting a genuine trade solely because a broker uses a larger minimum
  // or coarser volume step. Never exceed the broker-reported maximum.
  const precision = decimals(step);
  const stepIndexTolerance = (ratio) => Number.EPSILON * Math.max(1, Math.abs(ratio)) * 8;
  const minimumExecutable = Math.ceil((min / step) - stepIndexTolerance(min / step)) * step;
  const maximumExecutable = Number.isFinite(max)
    ? Math.floor((max / step) + stepIndexTolerance(max / step)) * step
    : Number.POSITIVE_INFINITY;
  if (!(maximumExecutable >= minimumExecutable)) throw new RangeError('broker volume constraints have no executable lot size');

  const minimumTolerance = stepIndexTolerance(lots / step) * step;
  if (lots < minimumExecutable - minimumTolerance) {
    const error = new RangeError('fixed lots are below the broker minimum; explicit risk sizing is required to authorize a minimum-volume floor');
    error.code = 'FIXED_LOTS_BELOW_BROKER_MINIMUM';
    error.minimumLots = Number(minimumExecutable.toFixed(precision));
    error.requestedLots = lots;
    throw error;
  }
  const bounded = Math.min(lots, maximumExecutable);
  let executable = Math.floor((bounded / step) + stepIndexTolerance(bounded / step)) * step;
  if (executable < minimumExecutable) executable = minimumExecutable;
  if (executable > maximumExecutable) executable = maximumExecutable;
  return Number(executable.toFixed(precision));
}

function normalizeAdaptiveLots(referenceLots, percent, instrument) {
  const reference = Number(referenceLots);
  const scale = Number(percent);
  if (!(reference > 0) || !(scale > 0) || !(scale <= 100)) {
    throw new TypeError('adaptive reference lots and percent between 0 and 100 required');
  }
  return normalizeFixedLots(reference * (scale / 100), instrument);
}

function openActionsFromGroup(group) {
  return group.legs.filter((leg) => leg?.takeProfitPlaceholder !== true).map((leg) => ({
    type: 'OPEN_POSITION', legId: leg.legId, targetIndex: leg.targetIndex, side: group.side, orderType: group.orderType,
    symbol: group.symbol, entry: group.entry, lots: leg.lots, stopLoss: leg.stopLoss, takeProfit: leg.takeProfit,
    idempotencyKey: `${group.id || 'group'}:leg:${leg.targetIndex}`,
  }));
}

export function buildExecutionPlan(intent, { account = {}, instrument = {}, currentMarketPrice, protectionReferencePrice, groupId = null, exposure = {} } = {}) {
  if (!intent?.side || !intent?.symbol?.canonical) throw new TypeError('canonical executable intent required');
  const entryMaterializedIntent = applyEntryZonePolicy(intent, account, currentMarketPrice);
  const safetyPolicy = account.safetyPolicy || account.safety_policy || { enabled: true };
  const protection = applyProtectionPolicy(entryMaterializedIntent, safetyPolicy, {
    currentMarketPrice: Number.isFinite(Number(protectionReferencePrice))
      ? Number(protectionReferencePrice)
      : currentMarketPrice,
  });
  if (!protection.ok) {
    return {
      status: 'BLOCKED',
      reason: protection.reason,
      policy: null,
      risk: null,
      riskEntryPrice: null,
      group: null,
      actions: [],
      protectionIssues: protection.protectionIssues,
      protectionSkips: protection.protectionSkips,
    };
  }

  const executableIntent = protection.intent;
  const targetCount = Array.isArray(executableIntent.takeProfits) && executableIntent.takeProfits.length ? executableIntent.takeProfits.length : 1;
  const volumeStep = Number(instrument.stepLots ?? 0.01);
  const sizingMode = String(account.sizingMode ?? 'RISK_PERCENT').toUpperCase();

  if ((['RISK_PERCENT', 'EQUITY_RISK_PERCENT', 'BALANCE_RISK_PERCENT', 'FIXED_RISK'].includes(sizingMode))
      && entryMaterializedIntent.stopLoss != null
      && executableIntent.stopLoss == null
      && protection.protectionSkips.some((item) => item.field === 'stopLoss')) {
    return {
      status: 'BLOCKED',
      reason: 'INVALID_PROTECTION_REQUIRED_FOR_RISK_SIZING',
      policy: null,
      risk: null,
      riskEntryPrice: null,
      group: null,
      actions: [],
      protectionIssues: protection.protectionIssues,
      protectionSkips: protection.protectionSkips,
    };
  }

  let risk = null;
  let totalLots;
  let riskEntryPrice = null;

  if (sizingMode === 'FIXED_LOTS') {
    const fixedLotsPerTarget = normalizeFixedLots(account.fixedLots, instrument);
    totalLots = Number((fixedLotsPerTarget * targetCount).toFixed(decimals(volumeStep)));
  } else if (sizingMode === 'ADAPTIVE_PERCENT') {
    const adaptiveLotsPerTarget = normalizeAdaptiveLots(account.referenceLots, account.adaptivePercent, instrument);
    totalLots = Number((adaptiveLotsPerTarget * targetCount).toFixed(decimals(volumeStep)));
  } else if (sizingMode === 'SYMBOL_EQUIVALENT') {
    const brokerEquivalentLots = Number(instrument.symbolEquivalentLots);
    if (!(brokerEquivalentLots > 0)) throw new TypeError('broker-authoritative symbol-equivalent lot sizing required');
    const lotsPerTarget = normalizeFixedLots(brokerEquivalentLots, instrument);
    totalLots = Number((lotsPerTarget * targetCount).toFixed(decimals(volumeStep)));
  } else if (sizingMode === 'BALANCE_PERCENT') {
    const brokerBalanceLots = Number(instrument.balancePercentLots);
    if (!(brokerBalanceLots > 0)) throw new TypeError('broker-authoritative balance-percent lot sizing required');
    const lotsPerTarget = normalizeFixedLots(brokerBalanceLots, instrument);
    totalLots = Number((lotsPerTarget * targetCount).toFixed(decimals(volumeStep)));
  } else if (sizingMode === 'RISK_PERCENT' || sizingMode === 'EQUITY_RISK_PERCENT' || sizingMode === 'BALANCE_RISK_PERCENT' || sizingMode === 'FIXED_RISK') {
    if (!Number.isFinite(Number(executableIntent.stopLoss))) throw new Error('stop loss is required for risk sizing');
    riskEntryPrice = resolveRiskEntry(executableIntent, currentMarketPrice);
    risk = calculateRiskPlan({
      equity: account.equity, balance: account.balance,
      riskPercent: ['RISK_PERCENT', 'EQUITY_RISK_PERCENT', 'BALANCE_RISK_PERCENT'].includes(sizingMode) ? account.riskPercent : undefined,
      riskAmount: sizingMode === 'FIXED_RISK' || Number(account.riskAmount ?? account.risk_amount) > 0 ? account.riskAmount ?? account.risk_amount : undefined,
      riskBasis: sizingMode === 'BALANCE_RISK_PERCENT' ? 'BALANCE' : (String(account.riskBasis ?? account.risk_basis ?? 'EQUITY').trim().toUpperCase() === 'BALANCE' ? 'BALANCE' : 'EQUITY'),
      entry: riskEntryPrice, stopLoss: executableIntent.stopLoss, targetCount, instrument,
    });
    totalLots = risk.totalLots;
  } else {
    throw new TypeError(`unsupported sizing mode: ${sizingMode}`);
  }

  const riskBasisAmount = risk
    ? (String(risk.riskBasis || 'EQUITY').toUpperCase() === 'BALANCE' ? Number(account.balance) : Number(account.equity))
    : 0;
  // maxRiskPercent is a per-leg ceiling. The aggregate group risk is checked
  // separately against maxOpenRiskPercent so multiple TP legs each retain the
  // configured per-leg budget without hiding their combined exposure.
  const actualRiskPercent = risk && riskBasisAmount > 0
    ? (Number(risk.estimatedRiskPerLegExact ?? risk.estimatedRiskPerLeg) / riskBasisAmount) * 100
    : (risk ? Number.POSITIVE_INFINITY : Number(exposure.estimatedRiskPercent || 0));
  const aggregateRiskPercent = risk && riskBasisAmount > 0
    ? (Number(risk.estimatedRiskExact ?? risk.estimatedRisk) / riskBasisAmount) * 100
    : actualRiskPercent;

  const policy = evaluateAccountPolicy(safetyPolicy, {
    symbol: executableIntent.symbol.canonical,
    totalLots,
    riskPercent: actualRiskPercent,
    newOpenRiskPercent: aggregateRiskPercent,
    minimumVolumeRiskOveragePercent: risk?.minimumFloorApplied === true && riskBasisAmount > 0
      ? Math.max(0, actualRiskPercent - (Number(risk.riskAmountExact ?? risk.riskAmount) / riskBasisAmount) * 100)
      : 0,
    currentDailyPnlPercent: exposure.currentDailyPnlPercent,
    currentOpenRiskPercent: exposure.currentOpenRiskPercent,
    actionKind: 'INCREASE_RISK',
  });

  if (!policy.allowed) {
    return {
      status: 'BLOCKED', policy, risk, riskEntryPrice, group: null, actions: [],
      protectionIssues: protection.protectionIssues,
      protectionSkips: protection.protectionSkips,
    };
  }

  const group = buildPositionGroup(executableIntent, { totalLots, volumeStep, groupId });
  const logicalEntry = logicalProtectionEntry(intent, currentMarketPrice, protectionReferencePrice);
  const logicalTakeProfits = Array.isArray(executableIntent.takeProfitTargetIndexes)
    && executableIntent.takeProfitTargetIndexes.some((targetIndex, index) => Number(targetIndex) !== index + 1)
    ? (Array.isArray(intent.takeProfits)
      ? intent.takeProfits.map((target) => validLogicalTarget(intent.side, target, logicalEntry) ? Number(target) : null)
      : [])
    : null;
  return {
    status: 'READY',
    policy,
    risk,
    riskEntryPrice,
    group,
    actions: openActionsFromGroup(group),
    protectionIssues: protection.protectionIssues,
    protectionSkips: protection.protectionSkips,
    effectiveIntent: executableIntent,
    ...(logicalTakeProfits ? { logicalTakeProfits } : {}),
  };
}
