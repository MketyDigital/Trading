function safePolicy(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function bool(value) {
  return value === true;
}

export function normalizeProtectionPolicy(value = {}) {
  const policy = safePolicy(value);
  const mode = String(policy.invalidProtectionPolicy ?? policy.invalid_protection_policy ?? 'reject_trade').trim().toLowerCase();
  return {
    invalidProtectionPolicy: mode === 'skip_invalid' ? 'skip_invalid' : 'reject_trade',
    allowInvalidStopLossSkip: bool(policy.allowInvalidStopLossSkip ?? policy.allow_invalid_stop_loss_skip),
    allowInvalidTakeProfitSkip: bool(policy.allowInvalidTakeProfitSkip ?? policy.allow_invalid_take_profit_skip),
  };
}

function entryReference(action = {}) {
  const entry = action.entry;
  if (!entry || typeof entry !== 'object') return null;
  if (entry.kind === 'PRICE') {
    const value = Number(entry.value);
    return Number.isFinite(value) ? value : null;
  }
  if (entry.kind === 'RANGE') {
    const min = Number(entry.min);
    const max = Number(entry.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return action.side === 'BUY' ? Math.max(min, max) : Math.min(min, max);
  }
  return null;
}

function stopIsValid(side, reference, stopLoss) {
  const stop = Number(stopLoss);
  if (!Number.isFinite(stop)) return false;
  if (reference == null) return true;
  if (side === 'BUY') return stop < reference;
  if (side === 'SELL') return stop > reference;
  return false;
}

function targetIsValid(side, reference, takeProfit) {
  const target = Number(takeProfit);
  if (!Number.isFinite(target)) return false;
  if (reference == null) return true;
  if (side === 'BUY') return target > reference;
  if (side === 'SELL') return target < reference;
  return false;
}

function targetSkipReason(index) {
  const numeric = Number(index);
  return Number.isInteger(numeric) && numeric > 0
    ? `TP${numeric}_SKIPPED_INVALID_GEOMETRY`
    : 'TP_SKIPPED_INVALID_GEOMETRY';
}

export function applyProtectionValidationPolicy(action = {}, rawPolicy = {}) {
  if (!action || typeof action !== 'object') {
    return { allowed: false, reason: 'INVALID_EXECUTION_ACTION', action, skipped: [] };
  }
  if (String(action.type || '').toUpperCase() !== 'OPEN_POSITION') {
    return { allowed: true, action: { ...action }, skipped: [] };
  }

  const hasStopLoss = action.stopLoss != null;
  const hasTakeProfit = action.takeProfit != null;
  if (!hasStopLoss && !hasTakeProfit) {
    return { allowed: true, action: { ...action }, skipped: [] };
  }

  const side = String(action.side || '').toUpperCase();
  if (!['BUY', 'SELL'].includes(side)) {
    return { allowed: false, reason: 'INVALID_EXECUTION_SIDE', action: { ...action }, skipped: [] };
  }

  const policy = normalizeProtectionPolicy(rawPolicy);
  const reference = entryReference(action);
  const next = { ...action };
  const skipped = [];

  if (hasStopLoss && !stopIsValid(side, reference, action.stopLoss)) {
    const maySkip = policy.invalidProtectionPolicy === 'skip_invalid' && policy.allowInvalidStopLossSkip;
    if (!maySkip) return { allowed: false, reason: 'INVALID_STOP_LOSS_GEOMETRY', action: { ...action }, skipped };
    next.stopLoss = null;
    skipped.push({ field: 'stopLoss', reason: 'SL_SKIPPED_INVALID_GEOMETRY' });
  }

  if (hasTakeProfit && !targetIsValid(side, reference, action.takeProfit)) {
    const maySkip = policy.invalidProtectionPolicy === 'skip_invalid' && policy.allowInvalidTakeProfitSkip;
    if (!maySkip) return { allowed: false, reason: 'INVALID_TAKE_PROFIT_GEOMETRY', action: { ...action }, skipped };
    next.takeProfit = null;
    skipped.push({
      field: 'takeProfit',
      ...(action.targetIndex != null ? { targetIndex: Number(action.targetIndex) } : {}),
      reason: targetSkipReason(action.targetIndex),
    });
  }

  return { allowed: true, action: next, skipped };
}
