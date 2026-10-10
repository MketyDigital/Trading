function text(value) { return value == null ? null : String(value); }
function nonEmpty(value) { const v = text(value)?.trim(); return v || null; }
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

function iso(value) {
  if (value == null) return undefined;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function millis(value) {
  if (value == null) return undefined;
  const n = new Date(value).getTime();
  return Number.isFinite(n) ? n : undefined;
}

function nullableFiniteNumber(value) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function hydratedNullableNumber(value) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function persistedEntry(group = {}) {
  const entry = group.entry && typeof group.entry === 'object' && !Array.isArray(group.entry)
    ? { ...group.entry }
    : {};
  const entryPrice = Number(group.entryPrice);
  if (Number.isFinite(entryPrice) && entryPrice > 0) entry.executedPrice = entryPrice;
  return entry;
}

export function groupToPersistenceRows(group = {}) {
  if (!group?.id) throw new TypeError('group id is required');
  if (!group?.workspaceId) throw new TypeError('workspaceId is required');
  if (!group?.tradeAccountId) throw new TypeError('tradeAccountId is required');
  if (!group?.symbol || !group?.side || !group?.orderType) throw new TypeError('canonical group identity is required');

  const groupRow = compact({
    workspace_id: String(group.workspaceId),
    trade_account_id: String(group.tradeAccountId),
    ...(isUuid(group.sourceEventId) ? { source_event_id: String(group.sourceEventId) } : {}),
    runtime_group_id: String(group.id),
    correlation_key: group.correlationKey || String(group.id),
    canonical_symbol: String(group.symbol),
    side: String(group.side).toUpperCase(),
    order_type: String(group.orderType).toUpperCase(),
    entry: persistedEntry(group),
    stop_loss: group.stopLoss ?? null,
    status: String(group.status || 'PLANNED').toUpperCase(),
    risk_plan: group.riskPlan ?? null,
    policy_snapshot: group.policySnapshot || {},
    source_instance_id: group.sourceInstanceId == null ? null : String(group.sourceInstanceId),
    source_event_ids: [...new Set((group.sourceEventIds || []).map(String))],
    thread_id: group.threadId == null ? null : String(group.threadId),
    incomplete: Boolean(group.incomplete),
    position_mode: String(group.positionMode || 'HEDGED').toUpperCase(),
    created_at: iso(group.createdAt),
    updated_at: iso(group.updatedAt),
  });

  const legs = (Array.isArray(group.legs) ? group.legs : []).map((leg) => {
    if (!leg?.legId) throw new TypeError('leg id is required');
    const currentLots = Number(leg.lots);
    if (!Number.isFinite(currentLots) || currentLots < 0) throw new TypeError('leg lots must be zero or positive');
    return compact({
      workspace_id: String(group.workspaceId),
      runtime_leg_id: String(leg.legId),
      target_index: Number(leg.targetIndex),
      lots: currentLots,
      requested_lots: nullableFiniteNumber(leg.requestedLots),
      executed_lots: nullableFiniteNumber(leg.executedLots),
      remaining_lots: currentLots,
      stop_loss: leg.stopLoss ?? null,
      take_profit: leg.takeProfit ?? null,
      status: String(leg.status || 'PLANNED').toUpperCase(),
      broker_position_id: nonEmpty(leg.brokerPositionId),
      broker_order_id: nonEmpty(leg.brokerOrderId),
      broker_deal_id: nonEmpty(leg.brokerDealId),
      fill_price: nullableFiniteNumber(leg.fillPrice),
      volume_step_lots: nullableFiniteNumber(leg.volumeStepLots),
      minimum_lots: nullableFiniteNumber(leg.minimumLots),
      action_type: nonEmpty(leg.actionType),
      failure_code: nonEmpty(leg.failureCode),
      parent_leg_id: nonEmpty(leg.parentLegId),
      lifecycle_role: nonEmpty(leg.lifecycleRole),
      lifecycle_tracking_enabled: leg.lifecycleTrackingEnabled === true,
      originating_order_id: nonEmpty(leg.originatingOrderId),
      logical_target_index: nullableFiniteNumber(leg.logicalTargetIndex),
      last_broker_observed_at: iso(leg.lastBrokerObservedAt),
      last_broker_source_version: nonEmpty(leg.lastBrokerSourceVersion),
      last_broker_status: nonEmpty(leg.lastBrokerStatus),
      last_broker_snapshot_fingerprint: nonEmpty(leg.lastBrokerSnapshotFingerprint),
      broker_deal_ids: Array.isArray(leg.brokerDealIds) ? [...new Set(leg.brokerDealIds.map(String))] : undefined,
      opened_at: iso(leg.openedAt),
      closed_at: iso(leg.closedAt),
      updated_at: iso(group.updatedAt),
    });
  });

  return { group: groupRow, legs };
}

export function persistenceRowsToGroup(row = {}) {
  if (!row?.runtime_group_id) throw new TypeError('persisted runtime_group_id is required');
  const persistedLegs = Array.isArray(row.position_legs) ? row.position_legs : [];
  const recoveredEntryPrice = row.entry?.kind === 'PRICE'
    ? Number(row.entry.value)
    : Number(row.entry?.executedPrice);
  return compact({
    id: String(row.runtime_group_id),
    workspaceId: row.workspace_id,
    tradeAccountId: row.trade_account_id,
    sourceEventId: row.source_event_id,
    correlationKey: row.correlation_key,
    symbol: row.canonical_symbol,
    side: row.side,
    orderType: row.order_type,
    entry: row.entry || {},
    entryPrice: Number.isFinite(recoveredEntryPrice) && recoveredEntryPrice > 0 ? recoveredEntryPrice : undefined,
    stopLoss: row.stop_loss,
    status: row.status,
    riskPlan: row.risk_plan,
    policySnapshot: row.policy_snapshot || {},
    sourceInstanceId: row.source_instance_id,
    sourceEventIds: Array.isArray(row.source_event_ids) ? row.source_event_ids.map(String) : [],
    threadId: row.thread_id,
    incomplete: Boolean(row.incomplete),
    positionMode: row.position_mode || 'HEDGED',
    createdAt: millis(row.created_at),
    updatedAt: millis(row.updated_at),
    legs: persistedLegs.slice().sort((a, b) => Number(a.target_index) - Number(b.target_index)).map((leg) => compact({
      legId: String(leg.runtime_leg_id),
      targetIndex: Number(leg.target_index),
      lots: Number(leg.remaining_lots ?? leg.lots),
      requestedLots: hydratedNullableNumber(leg.requested_lots),
      executedLots: hydratedNullableNumber(leg.executed_lots),
      stopLoss: leg.stop_loss,
      takeProfit: leg.take_profit,
      status: leg.status,
      brokerPositionId: leg.broker_position_id,
      brokerOrderId: leg.broker_order_id,
      brokerDealId: leg.broker_deal_id,
      fillPrice: hydratedNullableNumber(leg.fill_price),
      volumeStepLots: hydratedNullableNumber(leg.volume_step_lots),
      minimumLots: hydratedNullableNumber(leg.minimum_lots),
      actionType: leg.action_type,
      failureCode: leg.failure_code,
      parentLegId: leg.parent_leg_id,
      lifecycleRole: leg.lifecycle_role,
      lifecycleTrackingEnabled: leg.lifecycle_tracking_enabled === true,
      originatingOrderId: leg.originating_order_id,
      logicalTargetIndex: leg.logical_target_index != null && Number.isFinite(Number(leg.logical_target_index))
        ? Number(leg.logical_target_index) : undefined,
      lastBrokerObservedAt: millis(leg.last_broker_observed_at),
      lastBrokerSourceVersion: leg.last_broker_source_version,
      lastBrokerStatus: leg.last_broker_status,
      lastBrokerSnapshotFingerprint: leg.last_broker_snapshot_fingerprint,
      brokerDealIds: Array.isArray(leg.broker_deal_ids) ? leg.broker_deal_ids.map(String) : undefined,
      openedAt: millis(leg.opened_at),
      closedAt: millis(leg.closed_at),
    })),
  });
}

export class SupabaseTradeStatePersistence {
  constructor(supabase) {
    if (!supabase?.from) throw new TypeError('supabase client is required');
    this.supabase = supabase;
  }

  async saveGroup(group) {
    const rows = groupToPersistenceRows(group);
    const { data: savedGroup, error: groupError } = await this.supabase
      .from('position_groups')
      .upsert(rows.group, { onConflict: 'workspace_id,runtime_group_id' })
      .select('id')
      .single();
    if (groupError || !savedGroup?.id) throw new Error(`position group persistence failed: ${groupError?.message || 'missing row id'}`);

    if (rows.legs.length) {
      const legRows = rows.legs.map((leg) => ({ ...leg, position_group_id: savedGroup.id }));
      const { error: legError } = await this.supabase
        .from('position_legs')
        .upsert(legRows, { onConflict: 'position_group_id,runtime_leg_id' });
      if (legError) throw new Error(`position leg persistence failed: ${legError.message}`);
    }
    return group;
  }

  async loadGroup(workspaceId, groupId) {
    const { data, error } = await this.supabase
      .from('position_groups')
      .select('*, position_legs(*)')
      .eq('workspace_id', String(workspaceId))
      .eq('runtime_group_id', String(groupId))
      .maybeSingle();
    if (error) throw new Error(`trade state recovery failed: ${error.message}`);
    return data ? persistenceRowsToGroup(data) : null;
  }

  async loadActive(workspaceId) {
    const { data, error } = await this.supabase
      .from('position_groups')
      .select('*, position_legs(*)')
      .eq('workspace_id', String(workspaceId))
      .in('status', ['OPEN', 'PLANNED', 'PENDING'])
      .order('updated_at', { ascending: false });
    if (error) throw new Error(`active trade state recovery failed: ${error.message}`);
    return (data || []).map(persistenceRowsToGroup);
  }

  async listPendingOrderLifecycles() {
    const { data, error } = await this.supabase
      .from('position_legs')
      .select('workspace_id, position_group_id, runtime_leg_id, broker_order_id, created_at, position_groups!inner(runtime_group_id, trade_account_id, canonical_symbol)')
      .eq('status', 'PENDING')
      .eq('lifecycle_tracking_enabled', true)
      .not('broker_order_id', 'is', null);
    if (error) throw new Error(`pending order lifecycle scan failed: ${error.message}`);
    return (data || []).map((row) => ({
      workspaceId: String(row.workspace_id),
      groupId: String(row.position_groups?.runtime_group_id || ''),
      tradeAccountId: String(row.position_groups?.trade_account_id || ''),
      legId: String(row.runtime_leg_id || ''),
      brokerOrderId: String(row.broker_order_id || ''),
      symbol: String(row.position_groups?.canonical_symbol || ''),
      createdAt: millis(row.created_at),
    })).filter((row) => row.workspaceId && row.groupId && row.tradeAccountId && row.legId && row.brokerOrderId && row.symbol);
  }
}

export async function createSupabaseTradeStatePersistence(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return new SupabaseTradeStatePersistence(createClient(url, key));
}
