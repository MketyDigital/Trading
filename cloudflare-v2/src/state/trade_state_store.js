import { correlateTradingEvent } from '../correlation/trade_correlator.js';

const GROUP_PREFIX = 'group:';
const ACTIVE_STATUSES = new Set(['OPEN', 'PLANNED', 'PENDING']);

function groupKey(groupId) { return `${GROUP_PREFIX}${groupId}`; }

function actionTypeOf(execution = {}) {
  return String(execution?.actionType || '').trim().toUpperCase();
}

function executionStatus(existingLeg = {}, execution = {}) {
  const actionType = actionTypeOf(execution);
  if (actionType === 'CLOSE_POSITION') return 'CLOSED';
  if (actionType === 'CANCEL_PENDING') return 'CANCELLED';
  if (actionType === 'CLOSE_PARTIAL' || actionType === 'MODIFY_POSITION') return 'OPEN';

  const explicit = String(execution?.status || '').trim().toUpperCase();
  if (explicit) return explicit;
  if (execution?.brokerPositionId != null && String(execution.brokerPositionId).trim()) return 'OPEN';
  if (execution?.brokerOrderId != null && String(execution.brokerOrderId).trim()) return 'PENDING';
  return String(existingLeg?.status || 'PLANNED').toUpperCase();
}

function nextLegLots(currentLeg = {}, execution = {}) {
  const actionType = actionTypeOf(execution);
  const executedLots = Number(execution?.executedLots);
  const currentLots = Number(currentLeg?.lots);

  if (actionType === 'CLOSE_POSITION') return Number.isFinite(currentLots) ? 0 : undefined;
  if (actionType === 'CLOSE_PARTIAL') {
    if (!(Number.isFinite(executedLots) && executedLots > 0 && Number.isFinite(currentLots) && currentLots > 0)) return undefined;
    const remaining = currentLots - executedLots;
    if (!(remaining > 0) || remaining >= currentLots) return undefined;
    return Number(remaining.toFixed(12));
  }
  if (actionType === 'OPEN_POSITION' && Number.isFinite(executedLots) && executedLots > 0) return executedLots;
  return undefined;
}

function aggregateGroupStatus(legs = [], currentStatus = 'PLANNED') {
  const allStatuses = legs.map((leg) => String(leg?.status || '').toUpperCase()).filter(Boolean);
  const statuses = allStatuses.filter((status) => status !== 'SUPERSEDED');
  if (statuses.length === 0 && allStatuses.includes('SUPERSEDED')) return 'CLOSED';
  if (statuses.includes('OPEN')) return 'OPEN';
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.length > 0 && statuses.every((status) => status === 'CLOSED')) return 'CLOSED';
  if (statuses.length > 0 && statuses.every((status) => ['FAILED', 'CLOSED', 'CANCELLED'].includes(status))) {
    return statuses.includes('FAILED') ? 'FAILED' : 'CLOSED';
  }
  if (statuses.includes('PLANNED')) return 'PLANNED';
  return String(currentStatus || 'PLANNED').toUpperCase();
}

function executionPatch(currentLeg = {}, execution = {}, nowMs = Date.now()) {
  const actionType = actionTypeOf(execution);
  const patch = { ...execution };

  if (['MODIFY_POSITION', 'CLOSE_PARTIAL', 'CLOSE_POSITION', 'CANCEL_PENDING'].includes(actionType)) {
    for (const key of [
      'brokerPositionId',
      'brokerOrderId',
      'brokerDealId',
      'fillPrice',
      'executedLots',
      'volumeStepLots',
      'minimumLots',
    ]) {
      delete patch[key];
    }
  } else if (patch.fillPrice == null || patch.fillPrice === '') {
    delete patch.fillPrice;
  }

  if (actionType === 'MODIFY_POSITION') {
    if (execution.clearStopLoss === true) patch.stopLoss = null;
    if (execution.clearTakeProfit === true) patch.takeProfit = null;
    delete patch.clearStopLoss;
    delete patch.clearTakeProfit;
  }

  if (actionType === 'OPEN_POSITION' && String(execution?.status || '').trim().toUpperCase() !== 'FAILED') {
    patch.openedAt = Number.isFinite(Number(currentLeg?.openedAt)) ? Number(currentLeg.openedAt) : Number(nowMs);
  }
  if (actionType === 'CLOSE_POSITION' || actionType === 'CANCEL_PENDING') {
    patch.closedAt = Number(nowMs);
  }

  return patch;
}

export class TradeStateStore {
  constructor(storage, { persistence = null, workspaceId = null } = {}) {
    if (!storage?.get || !storage?.put || !storage?.list) throw new TypeError('durable storage interface is required');
    if (persistence && (!persistence?.saveGroup || !persistence?.loadActive || !persistence?.loadGroup)) {
      throw new TypeError('trade state persistence interface is invalid');
    }
    this.storage = storage;
    this.persistence = persistence;
    this.workspaceId = workspaceId == null ? null : String(workspaceId);
    this.hydrated = false;
  }

  async hydrateActive() {
    if (this.hydrated || !this.persistence || !this.workspaceId) return;
    const groups = await this.persistence.loadActive(this.workspaceId);
    for (const group of groups || []) await this.storage.put(groupKey(group.id), group);
    this.hydrated = true;
  }

  async getGroup(groupId) {
    const local = await this.storage.get(groupKey(groupId));
    if (local) return local;
    if (!this.persistence || !this.workspaceId) return null;
    const recovered = await this.persistence.loadGroup(this.workspaceId, groupId);
    if (!recovered) return null;
    await this.storage.put(groupKey(groupId), recovered);
    return recovered;
  }

  async putGroup(group) {
    if (!group?.id) throw new TypeError('group id is required');
    if (this.workspaceId && group?.workspaceId && String(group.workspaceId) !== this.workspaceId) {
      throw new Error('trade state store workspace mismatch');
    }
    const value = {
      ...group,
      sourceEventIds: [...new Set((group.sourceEventIds || []).map(String))],
      legs: Array.isArray(group.legs) ? group.legs.map((leg) => ({ ...leg })) : [],
    };
    if (this.persistence) await this.persistence.saveGroup(value);
    await this.storage.put(groupKey(group.id), value);
    return value;
  }

  async listActive() {
    await this.hydrateActive();
    const rows = await this.storage.list({ prefix: GROUP_PREFIX });
    return [...rows.values()].filter((group) => ACTIVE_STATUSES.has(String(group?.status || '')));
  }

  async appendSourceEvent(groupId, externalEventId, nowMs = Date.now()) {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('position group not found');
    group.sourceEventIds = [...new Set([...(group.sourceEventIds || []).map(String), String(externalEventId)])];
    group.updatedAt = Number(nowMs);
    return this.putGroup(group);
  }

  async bindLegExecution(groupId, legId, execution = {}, nowMs = Date.now()) {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('position group not found');
    const index = (group.legs || []).findIndex((leg) => String(leg.legId) === String(legId));
    if (index < 0) throw new Error('position group leg not found');
    const currentLeg = group.legs[index];
    const status = executionStatus(currentLeg, execution);
    const lots = nextLegLots(currentLeg, execution);
    const patch = executionPatch(currentLeg, execution, nowMs);
    group.legs[index] = {
      ...currentLeg,
      ...patch,
      requestedLots: Number.isFinite(Number(currentLeg?.requestedLots)) ? Number(currentLeg.requestedLots) : Number(currentLeg?.lots),
      ...(Number.isFinite(lots) && lots >= 0 ? { lots } : {}),
      status,
    };

    const storedEntryPrice = Number(group.entryPrice);
    if (actionTypeOf(execution) === 'OPEN_POSITION' && !(Number.isFinite(storedEntryPrice) && storedEntryPrice > 0)) {
      const fillPrice = Number(execution?.fillPrice);
      if (Number.isFinite(fillPrice) && fillPrice > 0) group.entryPrice = fillPrice;
    }

    if (actionTypeOf(execution) === 'MODIFY_POSITION') {
      const openLegs = group.legs.filter((leg) => String(leg?.status || '').toUpperCase() === 'OPEN');
      if (openLegs.length > 0) {
        const stopValues = openLegs.map((leg) => leg.stopLoss).filter((value) => value != null && Number.isFinite(Number(value))).map(Number);
        if (stopValues.length === openLegs.length && new Set(stopValues).size === 1) group.stopLoss = stopValues[0];
        else if (execution.clearStopLoss === true && openLegs.every((leg) => leg.stopLoss == null)) group.stopLoss = null;
      }
    }

    group.status = aggregateGroupStatus(group.legs, group.status);
    group.updatedAt = Number(nowMs);
    return this.putGroup(group);
  }

  async reconcilePendingOrderSnapshot(groupId, logicalLegId, {
    tradeAccountId,
    brokerOrderId,
    snapshot = {},
    nowMs = Date.now(),
  } = {}) {
    const group = await this.getGroup(groupId);
    if (!group) return { outcome: 'NOT_FOUND', group: null };
    if (this.workspaceId && String(group.workspaceId || '') !== this.workspaceId) {
      return { outcome: 'MISMATCH', group };
    }
    if (!tradeAccountId || String(group.tradeAccountId || '') !== String(tradeAccountId)) {
      return { outcome: 'MISMATCH', group };
    }

    const observedIndex = (group.legs || []).findIndex((leg) => String(leg.legId) === String(logicalLegId));
    if (observedIndex < 0) return { outcome: 'NOT_FOUND', group };
    const observedLeg = group.legs[observedIndex];
    const rootLegId = String(observedLeg.parentLegId || logicalLegId);
    const parentIndex = (group.legs || []).findIndex((leg) => String(leg.legId) === rootLegId);
    const parent = parentIndex >= 0 ? group.legs[parentIndex] : observedLeg;
    const currentOrderId = observedLeg.originatingOrderId ?? observedLeg.brokerOrderId;
    if (!brokerOrderId || String(currentOrderId || '') !== String(brokerOrderId)) {
      return { outcome: 'MISMATCH', group };
    }
    if (observedLeg.lifecycleTrackingEnabled !== true) {
      return { outcome: 'MISMATCH', group };
    }
    if (!observedLeg.lifecycleRole && String(observedLeg.status || '').toUpperCase() !== 'PENDING') {
      return { outcome: 'MISMATCH', group };
    }
    if (observedLeg.lifecycleRole && !['PARENT', 'PENDING_REMAINDER'].includes(observedLeg.lifecycleRole)) {
      return { outcome: 'MISMATCH', group };
    }
    if (observedLeg.lifecycleRole === 'PENDING_REMAINDER'
      && (parentIndex < 0 || parent.lifecycleRole !== 'PARENT' || parent.status !== 'SUPERSEDED')) {
      return { outcome: 'MISMATCH', group };
    }

    const status = String(snapshot.status || '').trim().toUpperCase();
    if (status === 'UNRESOLVED') return { outcome: 'UNCHANGED', group };
    if (!['PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'].includes(status)) {
      return { outcome: 'MISMATCH', group };
    }
    const remainingLots = Number(snapshot.remainingLots);
    const observedAt = Number(snapshot.observedAt);
    const requestedLots = Number(parent.requestedLots ?? parent.lots);
    const fills = Array.isArray(snapshot.fills) ? snapshot.fills : null;
    if (!fills || !Number.isFinite(remainingLots) || remainingLots < 0 || !Number.isFinite(observedAt)) {
      return { outcome: 'MISMATCH', group };
    }

    const byPosition = new Map();
    for (const fill of fills) {
      const dealId = String(fill?.dealId ?? '').trim();
      const positionId = String(fill?.positionId ?? '').trim();
      const dealIds = Array.isArray(fill?.dealIds) ? fill.dealIds.map((id) => String(id).trim()).filter(Boolean) : (dealId ? [dealId] : []);
      const lots = Number(fill?.lots);
      const fillPrice = fill?.fillPrice == null ? undefined : Number(fill.fillPrice);
      if (!positionId || (fill?.dealId != null && !dealId) || !(Number.isFinite(lots) && lots > 0)
        || (fillPrice != null && !(Number.isFinite(fillPrice) && fillPrice > 0))) {
        return { outcome: 'MISMATCH', group };
      }
      const prior = byPosition.get(positionId) || { positionId, lots: 0, dealIds: [], weightedPrice: 0, pricedLots: 0 };
      prior.lots += lots;
      prior.dealIds.push(...dealIds);
      if (Number.isFinite(fillPrice)) {
        prior.weightedPrice += fillPrice * lots;
        prior.pricedLots += lots;
      }
      byPosition.set(positionId, prior);
    }
    const totalFilled = [...byPosition.values()].reduce((sum, fill) => sum + fill.lots, 0);
    const tolerance = 1e-8;
    if (status !== 'CANCELLED' && Number.isFinite(requestedLots) && requestedLots > 0
      && Math.abs(totalFilled + remainingLots - requestedLots) > tolerance) {
      return { outcome: 'MISMATCH', group };
    }
    if (Number.isFinite(requestedLots) && requestedLots > 0 && totalFilled - requestedLots > tolerance) {
      return { outcome: 'MISMATCH', group };
    }
    if (status === 'PENDING' && (totalFilled > tolerance || Math.abs(remainingLots - requestedLots) > tolerance)) {
      return { outcome: 'MISMATCH', group };
    }
    if (status === 'PARTIALLY_FILLED' && (!(totalFilled > 0) || !(remainingLots > 0))) {
      return { outcome: 'MISMATCH', group };
    }
    if (status === 'FILLED' && (!(totalFilled > 0) || remainingLots > tolerance)) {
      return { outcome: 'MISMATCH', group };
    }
    if (status === 'CANCELLED' && remainingLots > tolerance) return { outcome: 'MISMATCH', group };

    const normalizedFills = [...byPosition.values()]
      .sort((a, b) => a.positionId.localeCompare(b.positionId))
      .map((fill) => ({
        positionId: fill.positionId,
        lots: Number(fill.lots.toFixed(12)),
        dealIds: [...new Set(fill.dealIds)].sort(),
        fillPrice: fill.pricedLots > 0 ? Number((fill.weightedPrice / fill.pricedLots).toFixed(12)) : undefined,
      }));
    const sourceVersion = snapshot.sourceVersion == null ? null : String(snapshot.sourceVersion);
    const fingerprint = JSON.stringify({ status, remainingLots: Number(remainingLots.toFixed(12)), fills: normalizedFills });
    const lastObservedAt = Number(observedLeg.lastBrokerObservedAt);
    if (Number.isFinite(lastObservedAt)) {
      if (observedAt < lastObservedAt) return { outcome: 'STALE', group };
      if (observedAt === lastObservedAt) {
        return observedLeg.lastBrokerSnapshotFingerprint === fingerprint
          ? { outcome: 'UNCHANGED', group }
          : { outcome: 'STALE', group };
      }
      if (['FILLED', 'CANCELLED'].includes(String(observedLeg.lastBrokerStatus || '').toUpperCase())) {
        return { outcome: 'UNCHANGED', group };
      }
    }
    if (status === 'PENDING') return { outcome: 'UNCHANGED', group };

    let nextTargetIndex = Math.max(0, ...group.legs.map((leg) => Number(leg.targetIndex) || 0));
    const parentTargetIndex = Number(parent.logicalTargetIndex ?? parent.targetIndex);
    const nextLegs = group.legs.map((leg) => ({ ...leg }));
    nextLegs[parentIndex] = {
      ...parent,
      status: 'SUPERSEDED',
      lifecycleRole: 'PARENT',
      lifecycleTrackingEnabled: true,
      originatingOrderId: String(brokerOrderId),
      lastBrokerObservedAt: observedAt,
      lastBrokerSourceVersion: sourceVersion,
      lastBrokerStatus: status,
      lastBrokerSnapshotFingerprint: fingerprint,
      logicalTargetIndex: parentTargetIndex,
      brokerOrderId: undefined,
      brokerPositionId: undefined,
    };

    for (const fill of normalizedFills) {
      const legId = `${rootLegId}:fill:${encodeURIComponent(fill.positionId)}`;
      const existingIndex = nextLegs.findIndex((leg) => String(leg.legId) === legId);
      const existing = existingIndex >= 0 ? nextLegs[existingIndex] : null;
      const child = {
        ...(existing || {}),
        legId,
        parentLegId: rootLegId,
        lifecycleRole: 'FILLED_POSITION',
        lifecycleTrackingEnabled: true,
        originatingOrderId: String(brokerOrderId),
        targetIndex: existing?.targetIndex ?? ++nextTargetIndex,
        logicalTargetIndex: parentTargetIndex,
        lots: fill.lots,
        requestedLots: fill.lots,
        executedLots: fill.lots,
        stopLoss: parent.stopLoss ?? group.stopLoss ?? null,
        takeProfit: parent.takeProfit ?? null,
        status: 'OPEN',
        brokerPositionId: fill.positionId,
        brokerOrderId: undefined,
        brokerDealId: fill.dealIds.length === 1 ? fill.dealIds[0] : undefined,
        brokerDealIds: fill.dealIds,
        fillPrice: fill.fillPrice,
        openedAt: existing?.openedAt ?? observedAt,
        lastBrokerObservedAt: observedAt,
        lastBrokerSourceVersion: sourceVersion,
      };
      if (existingIndex >= 0) nextLegs[existingIndex] = child;
      else nextLegs.push(child);
    }

    const remainderId = `${rootLegId}:remainder`;
    const previousRemainderIndex = nextLegs.findIndex((leg) => String(leg.legId) === remainderId);
    const shouldRemainPending = status === 'PARTIALLY_FILLED' && remainingLots > tolerance;
    if (shouldRemainPending) {
      const existing = previousRemainderIndex >= 0 ? nextLegs[previousRemainderIndex] : null;
      const remainder = {
        ...(existing || {}),
        legId: remainderId,
        parentLegId: rootLegId,
        lifecycleRole: 'PENDING_REMAINDER',
        lifecycleTrackingEnabled: true,
        originatingOrderId: String(brokerOrderId),
        targetIndex: existing?.targetIndex ?? ++nextTargetIndex,
        logicalTargetIndex: parentTargetIndex,
        lots: Number(remainingLots.toFixed(12)),
        requestedLots: Number(remainingLots.toFixed(12)),
        stopLoss: parent.stopLoss ?? group.stopLoss ?? null,
        takeProfit: parent.takeProfit ?? null,
        status: 'PENDING',
        brokerOrderId: String(brokerOrderId),
        brokerPositionId: undefined,
        lastBrokerObservedAt: observedAt,
        lastBrokerSourceVersion: sourceVersion,
        lastBrokerStatus: status,
        lastBrokerSnapshotFingerprint: fingerprint,
      };
      if (previousRemainderIndex >= 0) nextLegs[previousRemainderIndex] = remainder;
      else nextLegs.push(remainder);
    } else if (previousRemainderIndex >= 0) {
      const remainder = nextLegs[previousRemainderIndex];
      nextLegs[previousRemainderIndex] = {
        ...remainder,
        lots: 0,
        status: status === 'CANCELLED' ? 'CANCELLED' : 'FILLED',
        brokerOrderId: undefined,
        lastBrokerObservedAt: observedAt,
        lastBrokerSourceVersion: sourceVersion,
        lastBrokerStatus: status,
        lastBrokerSnapshotFingerprint: fingerprint,
      };
    }

    group.legs = nextLegs;
    group.status = aggregateGroupStatus(group.legs, group.status);
    group.updatedAt = Number(nowMs);
    const saved = await this.putGroup(group);
    return { outcome: 'APPLIED', group: saved };
  }

  async setGroupStatus(groupId, status, nowMs = Date.now()) {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('position group not found');
    group.status = String(status);
    group.updatedAt = Number(nowMs);
    return this.putGroup(group);
  }
}

export class TradeStateCoordinator {
  constructor(store, { correlationWindowMs = 120000 } = {}) {
    if (!store?.listActive) throw new TypeError('TradeStateStore is required');
    this.store = store;
    this.correlationWindowMs = Number(correlationWindowMs);
  }

  async correlate(event, interpretation, nowMs = Date.now()) {
    return correlateTradingEvent({
      event,
      interpretation,
      activeGroups: await this.store.listActive(),
      nowMs,
      correlationWindowMs: this.correlationWindowMs,
    });
  }
}
