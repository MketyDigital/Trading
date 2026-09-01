function totalLots(legs = []) {
  return Number(legs.reduce((sum, leg) => sum + Number(leg.lots || 0), 0).toFixed(8));
}

export function normalizePositionMode(platform, account = {}) {
  const type = String(platform || '').toLowerCase();
  if (type === 'ctrader') {
    const raw = account.accountType ?? account.account_type;
    if (raw === 0 || String(raw).toUpperCase() === 'HEDGED') return 'HEDGED';
    if (raw === 1 || String(raw).toUpperCase() === 'NETTED') return 'NETTED';
    if (raw === 2 || String(raw).toUpperCase() === 'SPREAD_BETTING') return 'SPREAD_BETTING';
  }
  if (type === 'mt5') {
    const raw = account.margin_mode ?? account.marginMode;
    if (raw === 2 || String(raw).toUpperCase().includes('HEDGING')) return 'HEDGED';
    if (raw === 0 || raw === 1 || String(raw).toUpperCase().includes('NETTING') || String(raw).toUpperCase().includes('EXCHANGE')) return 'NETTED';
  }
  return 'UNKNOWN';
}

function hedgedActions(group) {
  return group.legs.map((leg) => ({
    type: 'OPEN_POSITION',
    targetIndex: leg.targetIndex,
    side: group.side,
    orderType: group.orderType,
    symbol: group.symbol,
    entry: group.entry,
    lots: leg.lots,
    stopLoss: leg.stopLoss,
    takeProfit: leg.takeProfit,
  }));
}

export function materializePositionGroupForAccount(group, { positionMode } = {}) {
  if (!group?.legs?.length) throw new TypeError('position group with legs required');
  const mode = String(positionMode || '').toUpperCase();

  if (mode === 'HEDGED') {
    const materialized = {
      ...group,
      positionMode: 'HEDGED',
      legs: group.legs.map((leg) => ({ ...leg, executionMode: 'REAL_POSITION' })),
    };
    return { group: materialized, actions: hedgedActions(materialized) };
  }

  if (mode === 'NETTED') {
    const sorted = [...group.legs].sort((a, b) => a.targetIndex - b.targetIndex);
    const finalLeg = sorted.at(-1);
    const virtualTargets = sorted.map((leg) => ({
      targetIndex: leg.targetIndex,
      lots: leg.lots,
      takeProfit: leg.takeProfit,
      status: 'PLANNED',
    }));
    const materialized = {
      ...group,
      positionMode: 'NETTED',
      legs: sorted.map((leg) => ({ ...leg, executionMode: 'VIRTUAL_LEG' })),
      virtualTargets,
    };
    return {
      group: materialized,
      actions: [{
        type: 'OPEN_POSITION',
        targetIndex: null,
        side: group.side,
        orderType: group.orderType,
        symbol: group.symbol,
        entry: group.entry,
        lots: totalLots(sorted),
        stopLoss: group.stopLoss ?? sorted[0]?.stopLoss ?? null,
        takeProfit: finalLeg?.takeProfit ?? null,
        positionMode: 'NETTED',
      }],
    };
  }

  throw new TypeError(`unsupported position mode: ${mode || 'UNKNOWN'}`);
}

export function bindNettedBrokerPosition(group, brokerPositionId) {
  if (String(group?.positionMode).toUpperCase() !== 'NETTED') throw new TypeError('netted position group required');
  if (!brokerPositionId) throw new TypeError('brokerPositionId required');
  return {
    ...group,
    brokerPositionId,
    legs: group.legs.map((leg) => ({ ...leg, brokerPositionId })),
  };
}

export function buildNettedTargetAction(group, targetIndex) {
  if (String(group?.positionMode).toUpperCase() !== 'NETTED') throw new TypeError('netted position group required');
  const targets = group.virtualTargets || [];
  const target = targets.find((item) => item.targetIndex === Number(targetIndex));
  if (!target) return null;
  const finalIndex = Math.max(...targets.map((item) => item.targetIndex));
  if (target.targetIndex === finalIndex) return null;
  const brokerPositionId = group.brokerPositionId || group.legs.find((leg) => leg.brokerPositionId)?.brokerPositionId;
  if (!brokerPositionId) throw new Error('netted broker position is not bound');
  return {
    type: 'CLOSE_PARTIAL',
    brokerPositionId,
    targetIndex: target.targetIndex,
    lots: target.lots,
  };
}
