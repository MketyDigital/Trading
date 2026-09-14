function text(value) {
  return String(value ?? '').trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finite(value);
  return number != null && number > 0 ? number : null;
}

function isoTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const date = new Date(number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function groupRow(group, workspaceId) {
  const runtimeGroupId = text(group?.id);
  const symbol = text(group?.symbol);
  const side = text(group?.side).toUpperCase();
  const orderType = text(group?.orderType).toUpperCase();
  const tradeAccountId = text(group?.tradeAccountId);
  if (!runtimeGroupId) throw new TypeError('runtime group id is required');
  if (!symbol) throw new TypeError('group symbol is required');
  if (!['BUY', 'SELL'].includes(side)) throw new TypeError('group side is required');
  if (!orderType) throw new TypeError('group order type is required');
  if (!tradeAccountId) throw new TypeError('group trade account id is required');

  const row = {
    workspace_id: workspaceId,
    runtime_group_id: runtimeGroupId,
    trade_account_id: tradeAccountId,
    canonical_symbol: symbol,
    side,
    order_type: orderType,
    entry: jsonObject(group?.entry, finite(group?.entryPrice) != null ? { kind: 'PRICE', value: finite(group.entryPrice) } : {}),
    status: text(group?.status).toUpperCase() || 'PLANNED',
    source_instance_id: text(group?.sourceInstanceId) || null,
    source_event_ids: [...new Set((Array.isArray(group?.sourceEventIds) ? group.sourceEventIds : []).map(String).filter(Boolean))],
    thread_id: text(group?.threadId) || null,
    incomplete: Boolean(group?.incomplete),
    position_mode: text(group?.positionMode).toUpperCase() || 'HEDGED',
    risk_plan: group?.riskPlan == null ? null : jsonObject(group.riskPlan, null),
    policy_snapshot: jsonObject(group?.policySnapshot, {}),
  };

  const sourceEventId = text(group?.sourceEventId);
  if (sourceEventId) row.source_event_id = sourceEventId;
  const correlationKey = text(group?.correlationKey);
  if (correlationKey) row.correlation_key = correlationKey;
  const stopLoss = finite(group?.stopLoss);
  if (stopLoss != null) row.stop_loss = stopLoss;
  const createdAt = isoTime(group?.createdAt);
  if (createdAt) row.created_at = createdAt;
  const updatedAt = isoTime(group?.updatedAt);
  if (updatedAt) row.updated_at = updatedAt;
  return row;
}

function durableLegLots(leg = {}) {
  return positive(leg.lots) ?? positive(leg.executedLots) ?? positive(leg.minimumLots);
}

function legRow(leg, { workspaceId, databaseGroupId, groupUpdatedAt }) {
  const runtimeLegId = text(leg?.legId);
  const targetIndex = Number(leg?.targetIndex);
  const lots = durableLegLots(leg);
  if (!runtimeLegId) throw new TypeError('runtime leg id is required');
  if (!Number.isInteger(targetIndex) || targetIndex < 1) throw new TypeError('leg target index is required');
  if (!(lots > 0)) throw new TypeError('durable positive leg lots are required');

  const status = text(leg?.status).toUpperCase() || 'PLANNED';
  const row = {
    workspace_id: workspaceId,
    position_group_id: databaseGroupId,
    runtime_leg_id: runtimeLegId,
    target_index: targetIndex,
    lots,
    status,
  };

  for (const [source, destination] of [
    ['stopLoss', 'stop_loss'],
    ['takeProfit', 'take_profit'],
    ['fillPrice', 'fill_price'],
    ['executedLots', 'executed_lots'],
    ['volumeStepLots', 'volume_step_lots'],
    ['minimumLots', 'minimum_lots'],
  ]) {
    const value = finite(leg?.[source]);
    if (value != null) row[destination] = value;
  }

  for (const [source, destination] of [
    ['brokerPositionId', 'broker_position_id'],
    ['brokerOrderId', 'broker_order_id'],
    ['brokerDealId', 'broker_deal_id'],
  ]) {
    const value = text(leg?.[source]);
    if (value) row[destination] = value;
  }

  const updatedAt = isoTime(groupUpdatedAt);
  if (updatedAt) row.updated_at = updatedAt;
  if (status === 'OPEN') row.opened_at = isoTime(leg?.openedAt) || updatedAt || new Date().toISOString();
  if (status === 'CLOSED' || status === 'CANCELLED') row.closed_at = isoTime(leg?.closedAt) || updatedAt || new Date().toISOString();
  return row;
}

function assertResult(result, label) {
  if (result?.error) throw new Error(`${label} failed: ${result.error.message || result.error.code || 'database error'}`);
  return result?.data;
}

export async function materializeTradeStateGroup({ supabase, workspaceId, group } = {}) {
  const boundWorkspaceId = text(workspaceId);
  if (!boundWorkspaceId) throw new TypeError('workspaceId is required');
  if (!supabase?.from) throw new TypeError('supabase client is required');
  if (!group || typeof group !== 'object') throw new TypeError('Trade State group is required');
  const groupWorkspaceId = text(group.workspaceId);
  if (groupWorkspaceId && groupWorkspaceId !== boundWorkspaceId) throw new Error('trade state materialization workspace mismatch');

  const persistedGroup = assertResult(await supabase
    .from('position_groups')
    .upsert(groupRow(group, boundWorkspaceId), { onConflict: 'workspace_id,runtime_group_id' })
    .select('id')
    .maybeSingle(), 'position group materialization');

  const databaseGroupId = text(persistedGroup?.id);
  if (!databaseGroupId) throw new Error('position group materialization returned no id');

  const legs = Array.isArray(group.legs) ? group.legs : [];
  if (legs.length > 0) {
    const rows = legs.map((leg) => legRow(leg, {
      workspaceId: boundWorkspaceId,
      databaseGroupId,
      groupUpdatedAt: group.updatedAt,
    }));
    assertResult(await supabase
      .from('position_legs')
      .upsert(rows, { onConflict: 'position_group_id,runtime_leg_id' }), 'position leg materialization');
  }

  return { groupId: databaseGroupId, runtimeGroupId: text(group.id), legs: legs.length };
}

export { groupRow as durablePositionGroupRow, legRow as durablePositionLegRow };
