function text(value) { return value == null ? null : String(value); }

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

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function groupToPersistenceRows(group = {}) {
  if (!group?.id) throw new TypeError('group id is required');
  if (!group?.workspaceId) throw new TypeError('workspaceId is required');
  if (!group?.symbol || !group?.side || !group?.orderType) throw new TypeError('canonical group identity is required');

  const groupRow = compact({
    workspace_id: String(group.workspaceId),
    trade_account_id: group.tradeAccountId || null,
    source_event_id: group.sourceEventId || null,
    state_key: String(group.id),
    correlation_key: group.correlationKey || String(group.id),
    canonical_symbol: String(group.symbol),
    side: String(group.side).toUpperCase(),
    order_type: String(group.orderType),
    entry: group.entry || {},
    stop_loss: group.stopLoss ?? null,
    status: String(group.status || 'PLANNED').toUpperCase(),
    risk_plan: group.riskPlan ?? null,
    policy_snapshot: group.policySnapshot || {},
    source_instance_id: group.sourceInstanceId == null ? null : String(group.sourceInstanceId),
    source_event_ids: [...new Set((group.sourceEventIds || []).map(String))],
    thread_id: group.threadId == null ? null : String(group.threadId),
    incomplete: Boolean(group.incomplete),
    position_mode: String(group.positionMode || 'HEDGED').toUpperCase(),
    metadata: compact({ entryPrice: group.entryPrice ?? null }),
    created_at: iso(group.createdAt),
    updated_at: iso(group.updatedAt),
  });

  const legs = (Array.isArray(group.legs) ? group.legs : []).map((leg) => compact({
    workspace_id: String(group.workspaceId),
    leg_key: String(leg.legId),
    target_index: Number(leg.targetIndex),
    lots: Number(leg.lots),
    stop_loss: leg.stopLoss ?? null,
    take_profit: leg.takeProfit ?? null,
    status: String(leg.status || 'PLANNED').toUpperCase(),
    broker_position_id: text(leg.brokerPositionId),
    broker_order_id: text(leg.brokerOrderId),
    opened_at: iso(leg.openedAt),
    closed_at: iso(leg.closedAt),
    updated_at: iso(group.updatedAt),
    metadata: compact({
      brokerDealId: text(leg.brokerDealId),
      actionType: text(leg.actionType),
      failureCode: text(leg.failureCode),
      fillPrice: leg.fillPrice,
      executedLots: leg.executedLots,
      volumeStepLots: leg.volumeStepLots,
      minimumLots: leg.minimumLots,
    }),
  }));

  return { group: groupRow, legs };
}

export function persistenceRowsToGroup(row = {}) {
  if (!row?.state_key) throw new TypeError('persisted state_key is required');
  const metadata = row.metadata || {};
  const persistedLegs = Array.isArray(row.position_legs) ? row.position_legs : [];
  return compact({
    id: String(row.state_key),
    workspaceId: row.workspace_id,
    tradeAccountId: row.trade_account_id,
    sourceEventId: row.source_event_id,
    correlationKey: row.correlation_key,
    symbol: row.canonical_symbol,
    side: row.side,
    orderType: row.order_type,
    entry: row.entry || {},
    entryPrice: metadata.entryPrice ?? (row.entry?.kind === 'PRICE' ? row.entry.value : null),
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
    legs: persistedLegs
      .slice()
      .sort((a, b) => Number(a.target_index) - Number(b.target_index))
      .map((leg) => {
        const legMetadata = leg.metadata || {};
        return compact({
          legId: String(leg.leg_key),
          targetIndex: Number(leg.target_index),
          lots: Number(leg.lots),
          stopLoss: leg.stop_loss,
          takeProfit: leg.take_profit,
          status: leg.status,
          brokerPositionId: leg.broker_position_id,
          brokerOrderId: leg.broker_order_id,
          openedAt: millis(leg.opened_at),
          closedAt: millis(leg.closed_at),
          brokerDealId: legMetadata.brokerDealId,
          actionType: legMetadata.actionType,
          failureCode: legMetadata.failureCode,
          fillPrice: legMetadata.fillPrice,
          executedLots: legMetadata.executedLots,
          volumeStepLots: legMetadata.volumeStepLots,
          minimumLots: legMetadata.minimumLots,
        });
      }),
  });
}

export class SupabaseTradeStatePersistence {
  constructor(supabase, { workspaceId } = {}) {
    if (!supabase?.from) throw new TypeError('supabase client is required');
    if (!workspaceId) throw new TypeError('workspaceId is required');
    this.supabase = supabase;
    this.workspaceId = String(workspaceId);
  }

  async saveGroup(group) {
    if (String(group?.workspaceId || '') !== this.workspaceId) throw new Error('trade state persistence workspace mismatch');
    const rows = groupToPersistenceRows(group);
    const { data: savedGroup, error: groupError } = await this.supabase
      .from('position_groups')
      .upsert(rows.group, { onConflict: 'workspace_id,state_key' })
      .select('id')
      .single();
    if (groupError || !savedGroup?.id) throw new Error(`position group persistence failed: ${groupError?.message || 'missing row id'}`);

    const desiredLegKeys = new Set(rows.legs.map((leg) => String(leg.leg_key)));
    const { data: existingLegs, error: existingError } = await this.supabase
      .from('position_legs')
      .select('id,leg_key')
      .eq('position_group_id', savedGroup.id);
    if (existingError) throw new Error(`position leg lookup failed: ${existingError.message}`);

    const staleIds = (existingLegs || [])
      .filter((leg) => !desiredLegKeys.has(String(leg.leg_key)))
      .map((leg) => leg.id);
    if (staleIds.length) {
      const { error: deleteError } = await this.supabase.from('position_legs').delete().in('id', staleIds);
      if (deleteError) throw new Error(`stale position leg cleanup failed: ${deleteError.message}`);
    }

    if (rows.legs.length) {
      const legRows = rows.legs.map((leg) => ({ ...leg, position_group_id: savedGroup.id }));
      const { error: legError } = await this.supabase
        .from('position_legs')
        .upsert(legRows, { onConflict: 'position_group_id,leg_key' });
      if (legError) throw new Error(`position leg persistence failed: ${legError.message}`);
    }

    return group;
  }

  async loadActive() {
    const { data, error } = await this.supabase
      .from('position_groups')
      .select('*, position_legs(*)')
      .eq('workspace_id', this.workspaceId)
      .in('status', ['OPEN', 'PLANNED', 'PENDING'])
      .order('updated_at', { ascending: false });
    if (error) throw new Error(`active trade state recovery failed: ${error.message}`);
    return (data || []).map(persistenceRowsToGroup);
  }
}

export async function createSupabaseTradeStatePersistence(env = {}, workspaceId) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return new SupabaseTradeStatePersistence(createClient(url, key), { workspaceId });
}
