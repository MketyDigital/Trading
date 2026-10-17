import { groupToPersistenceRows, persistenceRowsToGroup, millis } from './trade_state_mapping.js';
export { groupToPersistenceRows, persistenceRowsToGroup } from './trade_state_mapping.js';

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

  async listBrokerTpProtectionCandidates({ pageSize = 50, pageSeed = 0 } = {}) {
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(pageSize)) || 50));
    const seed = Math.max(0, Math.trunc(Number(pageSeed)) || 0);
    const selection = 'workspace_id,position_group_id,runtime_leg_id,target_index,logical_target_index,lots,executed_lots,broker_position_id,stop_loss,take_profit,created_at,position_groups!inner(runtime_group_id,trade_account_id,source_event_id,source_instance_id,source_event_ids,thread_id,canonical_symbol,side,order_type,entry,stop_loss,status,created_at,updated_at)';
    const query = (options) => this.supabase.from('position_legs')
      .select(selection, options)
      .eq('status', 'OPEN').eq('position_groups.status', 'OPEN')
      .not('broker_position_id', 'is', null).not('take_profit', 'is', null);

    const { count, error: countError } = await query({ count: 'exact', head: true });
    if (countError) throw new Error(`broker TP candidate count failed: ${countError.message}`);
    const total = Math.max(0, Number(count) || 0);
    if (total === 0) return [];
    const pages = Math.max(1, Math.ceil(total / limit));
    const offset = (seed % pages) * limit;
    const { data: selected, error: selectedError } = await query()
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + limit - 1);
    if (selectedError) throw new Error(`broker TP candidate page failed: ${selectedError.message}`);
    const groupIds = [...new Set((selected || []).map((row) => String(row.position_group_id || '')).filter(Boolean))];
    if (groupIds.length === 0) return [];
    const { data, error } = await query().in('position_group_id', groupIds)
      .order('position_group_id', { ascending: true }).order('logical_target_index', { ascending: true });
    if (error) throw new Error(`broker TP candidate expansion failed: ${error.message}`);
    const rows = (Array.isArray(data) ? data : []).map((row) => {
        const group = row.position_groups || {};
        return {
          workspaceId: String(row.workspace_id || ''), groupId: String(group.runtime_group_id || row.position_group_id || ''),
          persistenceGroupId: String(row.position_group_id || ''),
          tradeAccountId: String(group.trade_account_id || ''), sourceEventId: String(group.source_event_id || ''),
          sourceInstanceId: group.source_instance_id == null ? null : String(group.source_instance_id),
          sourceEventIds: Array.isArray(group.source_event_ids) ? group.source_event_ids.map(String) : [],
          threadId: group.thread_id == null ? null : String(group.thread_id), symbol: String(group.canonical_symbol || ''),
          side: String(group.side || '').toUpperCase(), orderType: String(group.order_type || '').toUpperCase(),
          entry: group.entry && typeof group.entry === 'object' ? group.entry : {},
          groupStopLoss: group.stop_loss == null ? null : Number(group.stop_loss),
          groupCreatedAt: millis(group.created_at), groupUpdatedAt: millis(group.updated_at),
          legId: String(row.runtime_leg_id || ''), targetIndex: Number(row.logical_target_index ?? row.target_index),
          lots: Number(row.lots), executedLots: row.executed_lots == null ? null : Number(row.executed_lots),
          brokerPositionId: String(row.broker_position_id || ''),
          stopLoss: row.stop_loss == null ? (group.stop_loss == null ? null : Number(group.stop_loss)) : Number(row.stop_loss),
          takeProfit: Number(row.take_profit), createdAt: millis(row.created_at),
        };
      });
    return rows.filter((row) => row.workspaceId && row.groupId && row.tradeAccountId && row.legId
      && row.brokerPositionId && Number.isInteger(row.targetIndex) && row.targetIndex > 0
      && Number.isFinite(row.takeProfit) && row.takeProfit > 0);
  }
}

export async function createSupabaseTradeStatePersistence(env = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return new SupabaseTradeStatePersistence(createClient(url, key));
}
