import { calculateRiskPlan } from '../risk/risk_engine.js';
import { buildPositionGroup } from './position_group.js';
import { evaluateAccountPolicy } from './account_policy.js';

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
    type: 'OPEN_POSITION', targetIndex: leg.targetIndex, side: group.side, orderType: group.orderType,
    symbol: group.symbol, entry: group.entry, lots: leg.lots, stopLoss: leg.stopLoss, takeProfit: leg.takeProfit,
    idempotencyKey: `${group.id || 'group'}:leg:${leg.targetIndex}`,
  }));
}

export function buildExecutionPlan(intent, { account = {}, instrument = {}, currentMarketPrice, groupId = null, exposure = {} } = {}) {
  if (!intent?.side || !intent?.symbol?.canonical) throw new TypeError('canonical executable intent required');
  const targetCount = Array.isArray(intent.takeProfits) && intent.takeProfits.length ? intent.takeProfits.length : 1;
  const volumeStep = Number(instrument.stepLots ?? 0.01);
  const sizingMode = String(account.sizingMode ?? 'RISK_PERCENT').toUpperCase();

  let risk = null;
  let totalLots;
  let riskEntryPrice = null;

  if (sizingMode === 'FIXED_LOTS') {
    totalLots = normalizeFixedLots(account.fixedLots, instrument);
  } else if (sizingMode === 'RISK_PERCENT' || sizingMode === 'FIXED_RISK') {
    if (!Number.isFinite(Number(intent.stopLoss))) throw new Error('stop loss is required for risk sizing');
    riskEntryPrice = resolveRiskEntry(intent, currentMarketPrice);
    risk = calculateRiskPlan({
      equity: account.equity, balance: account.balance,
      riskPercent: sizingMode === 'RISK_PERCENT' ? account.riskPercent : undefined,
      riskAmount: sizingMode === 'FIXED_RISK' ? account.riskAmount : undefined,
      entry: riskEntryPrice, stopLoss: intent.stopLoss, targetCount, instrument,
    });
    totalLots = risk.totalLots;
  } else {
    throw new TypeError(`unsupported sizing mode: ${sizingMode}`);
  }

  const policy = evaluateAccountPolicy(account.safetyPolicy || { enabled: true }, {
    symbol: intent.symbol.canonical,
    totalLots,
    riskPercent: risk ? (Number(account.riskPercent) || 0) : Number(exposure.estimatedRiskPercent || 0),
    currentDailyPnlPercent: exposure.currentDailyPnlPercent,
    currentOpenRiskPercent: exposure.currentOpenRiskPercent,
    actionKind: 'INCREASE_RISK',
  });

  if (!policy.allowed) {
    return { status: 'BLOCKED', policy, risk, riskEntryPrice, group: null, actions: [] };
  }

  const group = buildPositionGroup(intent, { totalLots, volumeStep, groupId });
  return { status: 'READY', policy, risk, riskEntryPrice, group, actions: openActionsFromGroup(group) };
}
