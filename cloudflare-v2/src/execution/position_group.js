function decimals(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function floorToStep(value, step) {
  return Number((Math.floor((Number(value) / Number(step)) + 1e-12) * Number(step)).toFixed(decimals(step)));
}

function finiteProtection(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function currentStopLoss(group, leg) {
  return finiteProtection(leg?.stopLoss ?? group?.stopLoss);
}

function currentTakeProfit(leg) {
  return finiteProtection(leg?.takeProfit);
}

function preservedStopLoss(group, leg) {
  const value = currentStopLoss(group, leg);
  return value == null ? {} : { stopLoss: value };
}

function preservedTakeProfit(leg) {
  const value = currentTakeProfit(leg);
  return value == null ? {} : { takeProfit: value };
}

const COMPOUND_PROTECTION_TYPES = new Set([
  'MOVE_SL_TO_BE',
  'MOVE_SL',
  'CHANGE_TP',
  'REMOVE_SL',
  'REMOVE_TP',
]);

function coalesceCompoundProtectionActions(group, children) {
  if (!children.every((child) => child && COMPOUND_PROTECTION_TYPES.has(child.type))) return null;

  const openLegs = group.legs.filter((leg) => leg.status === 'OPEN' && leg.brokerPositionId);
  const states = openLegs.map((leg) => ({
    leg,
    stopLoss: currentStopLoss(group, leg),
    takeProfit: currentTakeProfit(leg),
    clearStopLoss: false,
    clearTakeProfit: false,
    touched: false,
  }));

  for (const child of children) {
    if (child.type === 'MOVE_SL_TO_BE') {
      if (!Number.isFinite(Number(group.entryPrice))) throw new Error('entryPrice is required for break-even');
      for (const state of states) {
        state.stopLoss = Number(group.entryPrice);
        state.clearStopLoss = false;
        state.touched = true;
      }
      continue;
    }

    if (child.type === 'MOVE_SL') {
      const stopLoss = Number(child.stopLoss);
      if (!Number.isFinite(stopLoss)) throw new Error('finite stopLoss is required');
      for (const state of states) {
        state.stopLoss = stopLoss;
        state.clearStopLoss = false;
        state.touched = true;
      }
      continue;
    }

    if (child.type === 'REMOVE_SL') {
      for (const state of states) {
        state.stopLoss = null;
        state.clearStopLoss = true;
        state.touched = true;
      }
      continue;
    }

    const targetIndex = child.targetIndex == null ? null : Number(child.targetIndex);
    const matchingStates = targetIndex == null
      ? states
      : states.filter(({ leg }) => Number(leg.targetIndex) === targetIndex);

    if (child.type === 'CHANGE_TP') {
      const takeProfit = Number(child.takeProfit);
      if (!Number.isFinite(takeProfit)) throw new Error('finite takeProfit is required');
      for (const state of matchingStates) {
        state.takeProfit = takeProfit;
        state.clearTakeProfit = false;
        state.touched = true;
      }
      continue;
    }

    if (child.type === 'REMOVE_TP') {
      for (const state of matchingStates) {
        state.takeProfit = null;
        state.clearTakeProfit = true;
        state.touched = true;
      }
    }
  }

  return states
    .filter((state) => state.touched)
    .map(({ leg, stopLoss, takeProfit, clearStopLoss, clearTakeProfit }) => ({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      ...(stopLoss != null ? { stopLoss } : clearStopLoss ? { clearStopLoss: true } : {}),
      ...(takeProfit != null ? { takeProfit } : clearTakeProfit ? { clearTakeProfit: true } : {}),
    }));
}

export function allocateVolumeAcrossTargets(totalLots, targetCount, volumeStep = 0.01) {
  if (!Number.isInteger(targetCount) || targetCount < 1) throw new TypeError('targetCount must be >= 1');
  if (!(Number(totalLots) > 0) || !(Number(volumeStep) > 0)) throw new TypeError('positive totalLots and volumeStep required');
  const totalSteps = Math.round(Number(totalLots) / Number(volumeStep));
  if (totalSteps < targetCount) throw new RangeError('totalLots is too small for target count at configured volumeStep');
  const baseSteps = Math.floor(totalSteps / targetCount);
  let remainder = totalSteps - baseSteps * targetCount;
  const result = [];
  for (let i = 0; i < targetCount; i += 1) {
    const steps = baseSteps + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    result.push(Number((steps * volumeStep).toFixed(decimals(volumeStep))));
  }
  return result;
}

export function buildPositionGroup(intent, { totalLots, volumeStep = 0.01, groupId = null } = {}) {
  const targets = Array.isArray(intent.takeProfits) && intent.takeProfits.length ? intent.takeProfits : [null];
  const volumes = allocateVolumeAcrossTargets(totalLots, targets.length, volumeStep);
  const entryPrice = intent.entry?.kind === 'PRICE' ? intent.entry.value : null;
  return {
    id: groupId,
    symbol: intent.symbol?.canonical,
    side: intent.side,
    orderType: intent.orderType,
    entryPrice,
    entry: intent.entry,
    stopLoss: intent.stopLoss ?? null,
    status: 'PLANNED',
    legs: targets.map((takeProfit, index) => ({
      legId: `leg-${index + 1}`,
      targetIndex: index + 1,
      lots: volumes[index],
      stopLoss: intent.stopLoss ?? null,
      takeProfit,
      status: 'PLANNED',
    })),
  };
}

export function reconcileFastEntry(existingGroup, completedIntent, { totalLots, volumeStep = 0.01 } = {}) {
  if (!existingGroup?.legs?.length) throw new TypeError('existing fast-entry group required');
  const desired = buildPositionGroup(completedIntent, { totalLots, volumeStep, groupId: existingGroup.id });
  const firstOpen = existingGroup.legs.find((leg) => leg.status === 'OPEN' && leg.brokerPositionId);
  if (!firstOpen) throw new Error('no open broker position available for fast-entry promotion');

  const actions = [{
    type: 'MODIFY_POSITION',
    legId: firstOpen.legId,
    brokerPositionId: firstOpen.brokerPositionId,
    symbol: completedIntent.symbol?.canonical,
    stopLoss: completedIntent.stopLoss ?? null,
    takeProfit: desired.legs[0]?.takeProfit ?? null,
    targetIndex: firstOpen.targetIndex ?? 1,
  }];

  for (let i = 1; i < desired.legs.length; i += 1) {
    actions.push({
      type: 'OPEN_POSITION',
      legId: desired.legs[i].legId,
      targetIndex: i + 1,
      side: completedIntent.side,
      orderType: completedIntent.orderType,
      symbol: completedIntent.symbol?.canonical,
      entry: completedIntent.entry,
      lots: desired.legs[i].lots,
      stopLoss: completedIntent.stopLoss ?? null,
      takeProfit: desired.legs[i].takeProfit ?? null,
    });
  }

  return { group: desired, actions };
}

export function buildTargetProtectionActions(group, targetIndex) {
  if (!group?.legs) return [];
  const index = Number(targetIndex);
  if (!Number.isInteger(index) || index < 1) throw new Error('valid targetIndex is required');

  const hitLeg = group.legs.find((leg) => Number(leg.targetIndex) === index);
  if (!hitLeg || !Number.isFinite(Number(hitLeg.takeProfit))) throw new Error('target-hit takeProfit is unavailable');

  let protectedStop;
  if (index === 1) {
    if (!Number.isFinite(Number(group.entryPrice))) throw new Error('entryPrice is required for TP1 protection');
    protectedStop = Number(group.entryPrice);
  } else {
    const previousLeg = group.legs.find((leg) => Number(leg.targetIndex) === index - 1);
    if (!previousLeg || !Number.isFinite(Number(previousLeg.takeProfit))) {
      throw new Error('previous target takeProfit is unavailable');
    }
    protectedStop = Number(previousLeg.takeProfit);
  }

  return group.legs
    .filter((leg) => Number(leg.targetIndex) > index && leg.status === 'OPEN' && leg.brokerPositionId)
    .map((leg) => ({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      stopLoss: protectedStop,
      ...preservedTakeProfit(leg),
      targetIndex: leg.targetIndex,
    }));
}

export function buildManagementActions(group, management) {
  if (!group?.legs) return [];

  if (management?.type === 'COMPOUND') {
    const children = Array.isArray(management.actions) ? management.actions : [];
    if (children.length < 2) throw new Error('compound management requires at least two actions');
    if (children.some((child) => !child || child.type === 'COMPOUND')) {
      throw new Error('nested compound management is not supported');
    }

    const coalescedProtection = coalesceCompoundProtectionActions(group, children);
    if (coalescedProtection) {
      if (coalescedProtection.length === 0) throw new Error('compound management action unavailable');
      return coalescedProtection;
    }

    const expanded = children.map((child) => {
      const actions = buildManagementActions(group, child);
      if (!Array.isArray(actions) || actions.length === 0) {
        throw new Error(`compound management action unavailable: ${String(child?.type || 'UNKNOWN')}`);
      }
      return actions;
    });
    return expanded.flat();
  }

  const openLegs = group.legs.filter((leg) => leg.status === 'OPEN' && leg.brokerPositionId);
  if (management?.type === 'TARGET_HIT') {
    return buildTargetProtectionActions(group, management.targetIndex);
  }
  if (management?.type === 'MOVE_SL_TO_BE') {
    if (!Number.isFinite(Number(group.entryPrice))) throw new Error('entryPrice is required for break-even');
    return openLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      managementType: 'MOVE_SL_TO_BE',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      side: group.side,
      entryPrice: Number(group.entryPrice),
      stopLoss: Number(group.entryPrice),
      ...preservedTakeProfit(leg),
    }));
  }
  if (management?.type === 'MOVE_SL') {
    const stopLoss = Number(management.stopLoss);
    if (!Number.isFinite(stopLoss)) throw new Error('finite stopLoss is required');
    return openLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      stopLoss,
      ...preservedTakeProfit(leg),
    }));
  }
  if (management?.type === 'CHANGE_TP') {
    const takeProfit = Number(management.takeProfit);
    if (!Number.isFinite(takeProfit)) throw new Error('finite takeProfit is required');
    const targetIndex = management.targetIndex == null ? null : Number(management.targetIndex);
    const matchingLegs = targetIndex == null
      ? openLegs
      : openLegs.filter((leg) => Number(leg.targetIndex) === targetIndex);
    return matchingLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      takeProfit,
      ...preservedStopLoss(group, leg),
    }));
  }
  if (management?.type === 'REMOVE_SL') {
    return openLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      managementType: 'REMOVE_SL',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      clearStopLoss: true,
      ...preservedTakeProfit(leg),
    }));
  }
  if (management?.type === 'REMOVE_TP') {
    const targetIndex = management.targetIndex == null ? null : Number(management.targetIndex);
    const matchingLegs = targetIndex == null
      ? openLegs
      : openLegs.filter((leg) => Number(leg.targetIndex) === targetIndex);
    return matchingLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      managementType: 'REMOVE_TP',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      clearTakeProfit: true,
      ...preservedStopLoss(group, leg),
    }));
  }
  if (management?.type === 'CLOSE_PARTIAL') {
    const requestedLots = management.lots == null ? null : Number(management.lots);
    const fraction = management.fraction == null ? null : Number(management.fraction);
    const hasLots = Number.isFinite(requestedLots) && requestedLots > 0;
    const hasFraction = Number.isFinite(fraction) && fraction > 0 && fraction <= 1;
    if (!hasLots && !hasFraction) throw new Error('partial close requires positive lots or fraction > 0 and <= 1');

    return openLegs.map((leg) => {
      const volumeStep = Number(management.volumeStep || leg.volumeStepLots || 0.01);
      if (!(volumeStep > 0)) throw new Error('partial-close volumeStep must be positive');
      const legLots = Number(leg.lots);
      let lots;
      if (hasLots) {
        lots = floorToStep(requestedLots, volumeStep);
        if (!(lots > 0)) throw new Error('partial-close lots are below the representable volume step');
        if (Number.isFinite(legLots) && lots >= legLots) {
          throw new Error('partial-close volume is not representable without full close');
        }
      } else if (Number.isFinite(legLots)) {
        lots = floorToStep(legLots * fraction, volumeStep);
        if (!(lots > 0) || lots >= legLots) {
          throw new Error('partial-close volume is not representable without full close');
        }
      }
      return {
        type: 'CLOSE_PARTIAL',
        legId: leg.legId,
        targetIndex: leg.targetIndex,
        brokerPositionId: leg.brokerPositionId,
        symbol: group.symbol,
        ...(hasFraction ? { fraction } : {}),
        lots,
      };
    });
  }
  if (management?.type === 'CANCEL_PENDING') {
    return group.legs
      .filter((leg) => leg.brokerOrderId)
      .map((leg) => ({
        type: 'CANCEL_PENDING',
        legId: leg.legId,
        targetIndex: leg.targetIndex,
        brokerOrderId: leg.brokerOrderId,
        symbol: group.symbol,
      }));
  }
  if (management?.type === 'CLOSE' || management?.type === 'CLOSE_ALL') {
    return openLegs.map((leg) => ({
      type: 'CLOSE_POSITION',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      brokerPositionId: leg.brokerPositionId,
      symbol: group.symbol,
      lots: leg.lots,
    }));
  }
  return [];
}
