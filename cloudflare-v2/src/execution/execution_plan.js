import { calculateRiskPlan } from '../risk/risk_engine.js';
import { buildPositionGroup } from './position_group.js';
import { evaluateAccountPolicy } from './account_policy.js';
import { applyProtectionPolicy } from './protection_validation_policy.js';
import { materializeExecutionEntry } from './entry_materializer.js';

function decimals(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
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
  const minimumExecutable = Math.ceil((min / step) - 1e-12) * step;
  const maximumExecutable = Number.isFinite(max)
    ? Math.floor((max / step) + 1e-12) * step
    : Number.POSITIVE_INFINITY;
  if (!(maximumExecutable >= minimumExecutable)) throw new RangeError('broker volume constraints have no executable lot size');

  const bounded = Math.min(Math.max(lots, minimumExecutable), maximumExecutable);
  let executable = Math.floor((bounded / step) + 1e-12) * step;
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
  return group.legs.map((leg) => ({
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

  if ((sizingMode === 'RISK_PERCENT' || sizingMode === 'FIXED_RISK')
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
  } else if (sizingMode === 'RISK_PERCENT' || sizingMode === 'FIXED_RISK') {
    if (!Number.isFinite(Number(executableIntent.stopLoss))) throw new Error('stop loss is required for risk sizing');
    riskEntryPrice = resolveRiskEntry(executableIntent, currentMarketPrice);
    risk = calculateRiskPlan({
      equity: account.equity, balance: account.balance,
      riskPercent: sizingMode === 'RISK_PERCENT' ? account.riskPercent : undefined,
      riskAmount: sizingMode === 'FIXED_RISK' ? account.riskAmount : undefined,
      entry: riskEntryPrice, stopLoss: executableIntent.stopLoss, targetCount, instrument,
    });
    totalLots = risk.totalLots;
  } else {
    throw new TypeError(`unsupported sizing mode: ${sizingMode}`);
  }

  const policy = evaluateAccountPolicy(safetyPolicy, {
    symbol: executableIntent.symbol.canonical,
    totalLots,
    riskPercent: risk ? (Number(account.riskPercent) || 0) : Number(exposure.estimatedRiskPercent || 0),
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
  };
}
