function text(value) {
  return String(value ?? '').trim();
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoTime(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compact(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function groupRow(group, workspaceId) {
  const id = text(group?.id);
  if (!id) throw new TypeError('position group id is required for durable materialization');
  const groupWorkspaceId = text(group?.workspaceId ?? group?.workspace_id);
  if (!groupWorkspaceId || groupWorkspaceId !== workspaceId) {
    throw new Error('position group workspace mismatch during durable materialization');
  }

  return compact({
    id,
    workspace_id: workspaceId,
    trade_account_id: text(group?.tradeAccountId ?? group?.trade_account_id) || null,
    source_event_id: text(group?.sourceEventId ?? group?.source_event_id) || null,
    source_instance_id: text(group?.sourceInstanceId ?? group?.source_instance_id) || null,
    source_event_ids: Array.isArray(group?.sourceEventIds)
      ? [...new Set(group.sourceEventIds.map(String).filter(Boolean))]
      : [],
    thread_id: text(group?.threadId ?? group?.thread_id) || null,
    correlation_key: text(group?.correlationKey ?? group?.correlation_key) || null,
    canonical_symbol: text(group?.symbol ?? group?.canonicalSymbol ?? group?.canonical_symbol).toUpperCase(),
    side: text(group?.side).toUpperCase(),
    order_type: text(group?.orderType ?? group?.order_type).toUpperCase() || 'MARKET',
    entry: group?.entry && typeof group.entry === 'object' ? group.entry : {},
    stop_loss: finiteNumber(group?.stopLoss ?? group?.stop_loss),
    status: text(group?.status).toUpperCase() || 'PLANNED',
    risk_plan: group?.riskPlan ?? group?.risk_plan ?? null,
    policy_snapshot: group?.policySnapshot ?? group?.policy_snapshot ?? {},
    incomplete: Boolean(group?.incomplete),
    position_mode: text(group?.positionMode ?? group?.position_mode).toUpperCase() || 'HEDGED',
    created_at: isoTime(group?.createdAt ?? group?.created_at) || undefined,
    updated_at: isoTime(group?.updatedAt ?? group?.updated_at) || new Date().toISOString(),
  });
}

function legRow(group, leg, workspaceId) {
  const groupId = text(group?.id);
  const stateLegId = text(leg?.legId ?? leg?.state_leg_id);
  const targetIndex = Number(leg?.targetIndex ?? leg?.target_index);
  const currentLots = finiteNumber(leg?.lots);
  const requestedLots = finiteNumber(leg?.requestedLots ?? leg?.requested_lots);
  const executedLots = finiteNumber(leg?.executedLots ?? leg?.executed_lots);
  const status = text(leg?.status).toUpperCase() || 'PLANNED';
  const actionType = text(leg?.actionType ?? leg?.last_action_type).toUpperCase();
  const lifecycleAt = isoTime(group?.updatedAt ?? group?.updated_at) || new Date().toISOString();

  if (!stateLegId) throw new TypeError('state leg id is required for durable materialization');
  if (!(Number.isInteger(targetIndex) && targetIndex > 0)) throw new TypeError('target index is required for durable materialization');
  if (!(currentLots != null && currentLots >= 0)) throw new TypeError('leg lots must be a non-negative number');

  return compact({
    workspace_id: workspaceId,
    position_group_id: groupId,
    state_leg_id: stateLegId,
    target_index: targetIndex,
    lots: currentLots,
    requested_lots: requestedLots ?? currentLots,
    executed_lots: executedLots ?? undefined,
    remaining_lots: currentLots,
    stop_loss: finiteNumber(leg?.stopLoss ?? leg?.stop_loss),
    take_profit: finiteNumber(leg?.takeProfit ?? leg?.take_profit),
    status,
    broker_position_id: text(leg?.brokerPositionId ?? leg?.broker_position_id) || undefined,
    broker_order_id: text(leg?.brokerOrderId ?? leg?.broker_order_id) || undefined,
    broker_deal_id: text(leg?.brokerDealId ?? leg?.broker_deal_id) || undefined,
    volume_step_lots: finiteNumber(leg?.volumeStepLots ?? leg?.volume_step_lots) ?? undefined,
    minimum_lots: finiteNumber(leg?.minimumLots ?? leg?.minimum_lots) ?? undefined,
    failure_code: text(leg?.failureCode ?? leg?.failure_code) || undefined,
    last_action_type: actionType || undefined,
    opened_at: actionType === 'OPEN_POSITION' ? lifecycleAt : undefined,
    closed_at: actionType === 'CLOSE_POSITION' || status === 'CLOSED' ? lifecycleAt : undefined,
    updated_at: lifecycleAt,
  });
}

async function checkedUpsert(query, label) {
  const result = await query;
  if (result?.error) throw new Error(`${label}: ${result.error.message || 'database error'}`);
  return result;
}

export function createSupabaseTradeStateMaterializer({ supabase, workspaceId } = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required for durable trade state materialization');
  const boundWorkspaceId = text(workspaceId);
  if (!boundWorkspaceId) throw new TypeError('workspaceId is required for durable trade state materialization');

  return {
    async putGroup(group = {}) {
      const durableGroup = groupRow(group, boundWorkspaceId);
      const durableLegs = (Array.isArray(group?.legs) ? group.legs : []).map((leg) => legRow(group, leg, boundWorkspaceId));

      await checkedUpsert(
        supabase.from('position_groups').upsert(durableGroup, { onConflict: 'id' }),
        'failed to materialize position group',
      );
      if (durableLegs.length) {
        await checkedUpsert(
          supabase.from('position_legs').upsert(durableLegs, { onConflict: 'position_group_id,target_index' }),
          'failed to materialize position legs',
        );
      }
      return group;
    },
  };
}

export { groupRow as durablePositionGroupRow, legRow as durablePositionLegRow };
