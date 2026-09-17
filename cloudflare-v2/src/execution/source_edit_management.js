function text(value) {
  return String(value ?? '').trim();
}

function canonicalSymbol(value) {
  return text(value?.canonical ?? value).toUpperCase();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function entryEqual(left = {}, right = {}) {
  const a = left && typeof left === 'object' ? left : {};
  const b = right && typeof right === 'object' ? right : {};
  const kindA = text(a.kind).toUpperCase();
  const kindB = text(b.kind).toUpperCase();
  if (kindA !== kindB) return false;
  if (kindA === 'MARKET') return true;
  if (kindA === 'PRICE') return finiteOrNull(a.value) === finiteOrNull(b.value);
  if (kindA === 'RANGE') {
    return finiteOrNull(a.min) === finiteOrNull(b.min)
      && finiteOrNull(a.max) === finiteOrNull(b.max);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function identityChanged(group = {}, intent = {}) {
  if (text(group.side).toUpperCase() !== text(intent.side).toUpperCase()) return true;
  if (canonicalSymbol(group.symbol) !== canonicalSymbol(intent.symbol)) return true;
  if (text(group.orderType).toUpperCase() !== text(intent.orderType).toUpperCase()) return true;
  if (!entryEqual(group.entry || { kind: 'MARKET' }, intent.entry || { kind: 'MARKET' })) return true;
  return false;
}

function openLegs(group = {}) {
  return Array.isArray(group.legs)
    ? group.legs.filter((leg) => leg?.status === 'OPEN' && leg?.brokerPositionId)
    : [];
}

export function buildEditedSignalManagement(group = {}, intent = {}, { rawText = '' } = {}) {
  if (identityChanged(group, intent)) {
    return { status: 'NEEDS_REVIEW', reason: 'EDIT_TRADE_IDENTITY_CHANGED', actions: [] };
  }

  const legs = openLegs(group);
  if (legs.length === 0) {
    return { status: 'NEEDS_REVIEW', reason: 'EDIT_ACTIVE_POSITION_UNAVAILABLE', actions: [] };
  }

  const suppliedTargets = Array.isArray(intent.takeProfits)
    ? intent.takeProfits.map(finiteOrNull).filter((value) => value != null)
    : [];
  const maxExistingTarget = Math.max(0, ...legs.map((leg) => Number(leg.targetIndex) || 0));
  if (suppliedTargets.length > maxExistingTarget) {
    return { status: 'NEEDS_REVIEW', reason: 'EDIT_TARGET_STRUCTURE_CHANGE_UNSUPPORTED', actions: [] };
  }

  // Omission in an edited signal is not interpreted as destructive removal.
  // Removal remains an explicit management command (REMOVE SL / REMOVE TP).
  const nextStop = finiteOrNull(intent.stopLoss);
  const stopChanged = nextStop != null && legs.some((leg) => finiteOrNull(leg.stopLoss ?? group.stopLoss) !== nextStop);
  const targetByIndex = new Map(suppliedTargets.map((value, index) => [index + 1, value]));

  const actions = [];
  for (const leg of legs) {
    const targetIndex = Number(leg.targetIndex) || 1;
    const nextTp = targetByIndex.get(targetIndex) ?? null;
    const tpChanged = nextTp != null && finiteOrNull(leg.takeProfit) !== nextTp;
    if (!stopChanged && !tpChanged) continue;

    actions.push({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: canonicalSymbol(group.symbol),
      ...(stopChanged ? { stopLoss: nextStop } : {}),
      ...(tpChanged ? { takeProfit: nextTp } : {}),
    });
  }

  if (actions.length === 0) {
    return { status: 'NO_ACTION', reason: 'EDIT_NO_SEMANTIC_CHANGE', actions: [] };
  }

  return {
    status: 'MANAGEMENT',
    reason: 'EDIT_PROTECTION_UPDATE',
    actions,
    rawText: String(rawText ?? ''),
  };
}
