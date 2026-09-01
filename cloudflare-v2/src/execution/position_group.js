function decimals(step) {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function roundToStep(value, step) {
  return Number((Math.round(value / step) * step).toFixed(decimals(step)));
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
    brokerPositionId: firstOpen.brokerPositionId,
    stopLoss: completedIntent.stopLoss ?? null,
    takeProfit: desired.legs[0]?.takeProfit ?? null,
    targetIndex: 1,
  }];

  for (let i = 1; i < desired.legs.length; i += 1) {
    actions.push({
      type: 'OPEN_POSITION',
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

export function buildManagementActions(group, management) {
  if (!group?.legs) return [];
  const openLegs = group.legs.filter((leg) => leg.status === 'OPEN' && leg.brokerPositionId);
  if (management?.type === 'MOVE_SL_TO_BE') {
    if (!Number.isFinite(Number(group.entryPrice))) throw new Error('entryPrice is required for break-even');
    return openLegs.map((leg) => ({ type: 'MODIFY_POSITION', brokerPositionId: leg.brokerPositionId, stopLoss: Number(group.entryPrice) }));
  }
  if (management?.type === 'CLOSE_PARTIAL') {
    const fraction = Number(management.fraction);
    return openLegs.map((leg) => ({
      type: 'CLOSE_PARTIAL',
      brokerPositionId: leg.brokerPositionId,
      fraction,
      lots: leg.lots ? roundToStep(leg.lots * fraction, management.volumeStep || 0.01) : undefined,
    }));
  }
  if (management?.type === 'CLOSE' || management?.type === 'CLOSE_ALL') {
    return openLegs.map((leg) => ({ type: 'CLOSE_POSITION', brokerPositionId: leg.brokerPositionId }));
  }
  return [];
}
