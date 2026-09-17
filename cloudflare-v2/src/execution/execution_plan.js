import { calculateRiskPlan } from '../risk/risk_engine.js';
import { buildPositionGroup } from './position_group.js';
import { evaluateAccountPolicy } from './account_policy.js';
import { applyProtectionPolicy } from './protection_validation_policy.js';

function decimals(step) {
  const text = String(step ?? 0.01);
  return text.includes('.') ? text.split('.')[1].length : 0;
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
  const stepped = Math.floor(lots / step) * step;
  if (stepped < min) throw new RangeError('fixed lots are below broker minimum');
  if (stepped > max) throw new RangeError('fixed lots exceed broker maximum');
  return Number(stepped.toFixed(decimals(step)));
}

function openActionsFromGroup(group) {
  return group.legs.map((leg) => ({
    type: 'OPEN_POSITION', legId: leg.legId, targetIndex: leg.targetIndex, side: group.side, orderType: group.orderType,
    symbol: group.symbol, entry: group.entry, lots: leg.lots, stopLoss: leg.stopLoss, takeProfit: leg.takeProfit,
    idempotencyKey: `${group.id || 'group'}:leg:${leg.targetIndex}`,
  }));
}

export function buildExecutionPlan(intent, { account = {}, instrument = {}, currentMarketPrice, groupId = null, exposure = {} } = {}) {
  if (!intent?.side || !intent?.symbol?.canonical) throw new TypeError('canonical executable intent required');
  const safetyPolicy = account.safetyPolicy || account.safety_policy || { enabled: true };
  const protection = applyProtectionPolicy(intent, safetyPolicy, { currentMarketPrice });
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
      && intent.stopLoss != null
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
