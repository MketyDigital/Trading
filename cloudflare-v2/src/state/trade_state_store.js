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
  const statuses = legs.map((leg) => String(leg?.status || '').toUpperCase()).filter(Boolean);
  if (statuses.includes('OPEN')) return 'OPEN';
  if (statuses.includes('PENDING')) return 'PENDING';
  if (statuses.length > 0 && statuses.every((status) => status === 'CLOSED')) return 'CLOSED';
  if (statuses.length > 0 && statuses.every((status) => ['FAILED', 'CLOSED', 'CANCELLED'].includes(status))) {
    return statuses.includes('FAILED') ? 'FAILED' : 'CLOSED';
  }
  if (statuses.includes('PLANNED')) return 'PLANNED';
  return String(currentStatus || 'PLANNED').toUpperCase();
}

function sanitizedExecutionPatch(currentLeg = {}, execution = {}, nowMs = Date.now()) {
  const actionType = actionTypeOf(execution);
  const patch = { ...execution };

  if (['MODIFY_POSITION', 'CLOSE_PARTIAL', 'CLOSE_POSITION', 'CANCEL_PENDING'].includes(actionType)) {
    delete patch.brokerPositionId;
    delete patch.brokerOrderId;
    delete patch.brokerDealId;
    delete patch.fillPrice;
    delete patch.executedLots;
    delete patch.volumeStepLots;
    delete patch.minimumLots;
  }

  if (actionType === 'OPEN_POSITION' && String(execution?.status || '').toUpperCase() !== 'FAILED') {
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
    const patch = sanitizedExecutionPatch(currentLeg, execution, nowMs);
    group.legs[index] = {
      ...currentLeg,
      ...patch,
      requestedLots: Number.isFinite(Number(currentLeg?.requestedLots)) ? Number(currentLeg.requestedLots) : Number(currentLeg?.lots),
      ...(Number.isFinite(lots) && lots >= 0 ? { lots } : {}),
      status,
    };

    if (actionTypeOf(execution) === 'OPEN_POSITION' && !Number.isFinite(Number(group.entryPrice))) {
      const fillPrice = Number(execution?.fillPrice);
      if (Number.isFinite(fillPrice) && fillPrice > 0) group.entryPrice = fillPrice;
    }

    group.status = aggregateGroupStatus(group.legs, group.status);
    group.updatedAt = Number(nowMs);
    return this.putGroup(group);
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