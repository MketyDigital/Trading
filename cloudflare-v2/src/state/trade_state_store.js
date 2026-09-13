import { correlateTradingEvent } from '../correlation/trade_correlator.js';

const GROUP_PREFIX = 'group:';
const ACTIVE_STATUSES = new Set(['OPEN', 'PLANNED', 'PENDING']);

function groupKey(groupId) { return `${GROUP_PREFIX}${groupId}`; }

function executionStatus(existingLeg = {}, execution = {}) {
  const explicit = String(execution?.status || '').trim().toUpperCase();
  if (explicit) return explicit;
  if (execution?.brokerPositionId != null && String(execution.brokerPositionId).trim()) return 'OPEN';
  if (execution?.brokerOrderId != null && String(execution.brokerOrderId).trim()) return 'PENDING';
  return String(existingLeg?.status || 'PLANNED').toUpperCase();
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

export class TradeStateStore {
  constructor(storage) {
    if (!storage?.get || !storage?.put || !storage?.list) throw new TypeError('durable storage interface is required');
    this.storage = storage;
  }

  async getGroup(groupId) {
    return await this.storage.get(groupKey(groupId)) || null;
  }

  async putGroup(group) {
    if (!group?.id) throw new TypeError('group id is required');
    const value = {
      ...group,
      sourceEventIds: [...new Set((group.sourceEventIds || []).map(String))],
      legs: Array.isArray(group.legs) ? group.legs : [],
    };
    await this.storage.put(groupKey(group.id), value);
    return value;
  }

  async listActive() {
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
    const executedLots = Number(execution?.executedLots);
    group.legs[index] = {
      ...currentLeg,
      ...execution,
      ...(Number.isFinite(executedLots) && executedLots > 0 ? { lots: executedLots } : {}),
      status,
    };
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
