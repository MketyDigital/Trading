import { correlateTradingEvent } from '../correlation/trade_correlator.js';

const GROUP_PREFIX = 'group:';
const ACTIVE_STATUSES = new Set(['OPEN', 'PLANNED', 'PENDING']);

function groupKey(groupId) { return `${GROUP_PREFIX}${groupId}`; }

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
    group.legs[index] = { ...group.legs[index], ...execution };
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
