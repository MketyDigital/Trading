import { decryptConnectionCredentials } from '../security/connection_credentials.js';
import { accountSymbolCatalogFromProviderConfig, resolveAccountSymbol } from './account_symbol_catalog.js';
import { createProductionExecutionDependencies } from './production_execution_deps_unified.js';
import { executeProductionPlan } from './production_execution_coordinator.js';
import { createProductionTradeStateBinder } from '../state/production_trade_state_binder.js';
import {
  resolveTradingAccessRuntimeControl,
  resolveBrokerExecutionRuntimeControl,
  resolveLiveBrokerExecutionRuntimeControl,
} from '../persistence/supabase_runtime_control_store.js';

function text(value) { return String(value ?? '').trim(); }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }

function tradeStateClient(env, workspaceId) {
  const namespace = env?.TRADE_STATE_NAMESPACE;
  const token = text(env?.TRADE_STATE_INTERNAL_TOKEN);
  if (!namespace?.idFromName || !namespace?.get || !token) throw new Error('TRADE_STATE_UNAVAILABLE');
  const stub = namespace.get(namespace.idFromName(String(workspaceId)));
  const headers = {
    'content-type': 'application/json',
    'x-mkety-internal-token': token,
    'x-mkety-workspace-id': String(workspaceId),
  };
  async function call(path, method, payload) {
    const response = await stub.fetch(`https://trade-state.internal${path}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`TRADE_STATE_${response.status}:${body?.error || 'UNKNOWN'}`);
    return body;
  }
  return {
    getGroup: (groupId) => call(`/groups/${encodeURIComponent(String(groupId))}`, 'GET'),
    putGroup: (group) => call('/groups', 'POST', group),
  };
}

function closeSidePrice(side, tick = {}) {
  const value = String(side).toUpperCase() === 'BUY' ? tick.bid : tick.ask;
  const n = finite(value);
  return n != null && n > 0 ? n : null;
}

function stopInvalid(side, marketPrice, stopLoss) {
  const sideValue = String(side).toUpperCase();
  const market = finite(marketPrice);
  const stop = finite(stopLoss);
  if (market == null || stop == null) return true;
  return sideValue === 'BUY' ? market <= stop : market >= stop;
}

function targetPassed(side, marketPrice, target) {
  const sideValue = String(side).toUpperCase();
  const market = finite(marketPrice);
  const tp = finite(target);
  if (market == null || tp == null) return false;
  return sideValue === 'BUY' ? market >= tp : market <= tp;
}

function passedTargetCount(side, marketPrice, targets = []) {
  let count = 0;
  for (const target of targets) {
    if (!targetPassed(side, marketPrice, target)) break;
    count += 1;
  }
  return count;
}

function protectionStop({ group, intent, passedCount }) {
  if (passedCount <= 0) return finite(intent.stopLoss);
  const entry = finite(group.entryPrice ?? group.entry?.executedPrice);
  if (passedCount === 1) return entry;
  return finite(intent.takeProfits?.[passedCount - 2]);
}

export function buildLiveRepairDecision({ group, intent, marketPrice, lotValue } = {}) {
  const targets = Array.isArray(intent?.takeProfits) ? intent.takeProfits.map(finite).filter((v) => v != null) : [];
  const side = String(intent?.side || group?.side || '').toUpperCase();
  const stopLoss = finite(intent?.stopLoss ?? group?.stopLoss);
  const lot = finite(lotValue);
  if (!group?.id || !['BUY', 'SELL'].includes(side) || !targets.length || !(lot > 0) || stopLoss == null) {
    return { ok: false, reason: 'REPAIR_INPUT_INVALID' };
  }
  if (stopInvalid(side, marketPrice, stopLoss)) {
    return { ok: false, reason: 'SIGNAL_STOP_ALREADY_INVALIDATED', marketPrice, stopLoss };
  }
  const passedCount = passedTargetCount(side, marketPrice, targets);
  return {
    ok: true,
    side,
    stopLoss,
    targets,
    passedCount,
    protectionStop: protectionStop({ group, intent: { ...intent, stopLoss, takeProfits: targets }, passedCount }),
    marketPrice,
    lot,
  };
}

async function loadMt5ConnectorContext({ env, account, symbol }) {
  const masterKey = text(env?.TRADING_MASTER_KEY);
  const ciphertext = text(account?.credential_ciphertext);
  if (!masterKey || !ciphertext) throw new Error('BROKER_CREDENTIALS_UNAVAILABLE');
  const credentials = await decryptConnectionCredentials('mt5_connector', ciphertext, masterKey);
  const baseUrl = text(credentials.gatewayUrl).replace(/\/+$/, '');
  const controlSecret = text(credentials.controlSecret);
  if (!baseUrl || !controlSecret) throw new Error('MT5_CONNECTOR_CONFIGURATION_UNAVAILABLE');

  const identityResponse = await fetch(`${baseUrl}/v1/mt5-connections/${encodeURIComponent(account.id)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
    signal: AbortSignal.timeout(5000),
  });
  const identity = await identityResponse.json().catch(() => ({}));
  if (!identityResponse.ok || identity?.online !== true) throw new Error('MT5_CONNECTOR_OFFLINE');
  if (String(identity.accountRowId || '') !== String(account.id)) throw new Error('MT5_CONNECTOR_ACCOUNT_MISMATCH');
  if (String(identity?.identity?.accountNumber || '') !== String(account.account_id || '')) throw new Error('MT5_BROKER_ACCOUNT_MISMATCH');
  if (text(account.server_name) && text(identity?.identity?.serverName) !== text(account.server_name)) throw new Error('MT5_BROKER_SERVER_MISMATCH');
  if (account.environment === 'live' && identity?.identity?.isLive !== true) throw new Error('MT5_BROKER_ENVIRONMENT_MISMATCH');

  const persisted = accountSymbolCatalogFromProviderConfig(account.provider_config || {});
  const liveCatalog = Array.isArray(identity?.identity?.symbols) && identity.identity.symbols.length
    ? identity.identity.symbols : persisted.catalog;
  const resolved = resolveAccountSymbol(symbol, liveCatalog, persisted.aliases);
  if (!resolved.ok) throw new Error(`BROKER_SYMBOL_${resolved.reason || 'UNAVAILABLE'}`);

  const contextResponse = await fetch(
    `${baseUrl}/v1/mt5-context/${encodeURIComponent(account.id)}?symbol=${encodeURIComponent(resolved.platformSymbol)}`,
    {
      headers: { Accept: 'application/json', Authorization: `Bearer ${controlSecret}` },
      signal: AbortSignal.timeout(7000),
    },
  );
  const body = await contextResponse.json().catch(() => ({}));
  if (!contextResponse.ok || body?.ok !== true) throw new Error(body?.reason || 'MT5_CONTEXT_UNAVAILABLE');
  if (String(body.accountRowId || '') !== String(account.id)) throw new Error('MT5_CONTEXT_ACCOUNT_MISMATCH');
  return { ...body.context, platformSymbol: resolved.platformSymbol };
}

export function selectCompletedRepairEvent(events = [], { symbol = null, side = null } = {}) {
  const expectedSymbol = text(symbol).toUpperCase();
  const expectedSide = text(side).toUpperCase();
  return (Array.isArray(events) ? events : [])
    .filter((event) => {
      const intent = event?.canonical_intent;
      if (!intent || intent.incomplete === true) return false;
      const eventSymbol = text(intent?.symbol?.canonical ?? intent?.symbol).toUpperCase();
      const eventSide = text(intent?.side).toUpperCase();
      const targets = Array.isArray(intent?.takeProfits) ? intent.takeProfits.filter((value) => finite(value) != null) : [];
      if (expectedSymbol && eventSymbol !== expectedSymbol) return false;
      if (expectedSide && eventSide !== expectedSide) return false;
      return finite(intent?.stopLoss) != null && targets.length > 0;
    })
    .sort((left, right) => {
      const a = Date.parse(left?.created_at || '') || 0;
      const b = Date.parse(right?.created_at || '') || 0;
      return b - a;
    })[0] || null;
}

async function loadGroupIntentAndAccount(supabase, workspaceId, groupId) {
  const select = 'id,runtime_group_id,workspace_id,trade_account_id,source_event_id,source_event_ids,canonical_symbol,side,stop_loss,status';
  let lookup = await supabase
    .from('position_groups')
    .select(select)
    .eq('workspace_id', String(workspaceId))
    .eq('runtime_group_id', String(groupId))
    .maybeSingle();
  if (lookup.error) throw new Error('POSITION_GROUP_LOOKUP_FAILED');
  if (!lookup.data) {
    lookup = await supabase
      .from('position_groups')
      .select(select)
      .eq('workspace_id', String(workspaceId))
      .eq('id', String(groupId))
      .maybeSingle();
    if (lookup.error) throw new Error('POSITION_GROUP_LOOKUP_FAILED');
  }
  const groupRow = lookup.data;
  if (!groupRow) throw new Error('POSITION_GROUP_NOT_FOUND');

  const { data: account, error: accountError } = await supabase
    .from('trade_accounts').select('*')
    .eq('workspace_id', String(workspaceId))
    .eq('id', String(groupRow.trade_account_id))
    .maybeSingle();
  if (accountError || !account) throw new Error('TRADE_ACCOUNT_NOT_FOUND');

  const events = [];
  if (groupRow.source_event_id) {
    const result = await supabase.from('trading_events')
      .select('id,external_event_id,canonical_intent,raw_text,created_at')
      .eq('id', String(groupRow.source_event_id)).maybeSingle();
    if (!result.error && result.data) events.push(result.data);
  }

  const sourceEventIds = Array.isArray(groupRow.source_event_ids)
    ? [...new Set(groupRow.source_event_ids.map(String).filter(Boolean))]
    : [];
  if (sourceEventIds.length) {
    const result = await supabase.from('trading_events')
      .select('id,external_event_id,canonical_intent,raw_text,created_at')
      .in('external_event_id', sourceEventIds);
    if (result.error) throw new Error('COMPLETED_SIGNAL_EVENT_LOOKUP_FAILED');
    for (const item of (result.data || [])) {
      if (!events.some((existing) => String(existing?.id) === String(item?.id))) events.push(item);
    }
  }

  const event = selectCompletedRepairEvent(events, {
    symbol: groupRow.canonical_symbol,
    side: groupRow.side,
  });
  if (!event) throw new Error('COMPLETED_SIGNAL_INTENT_NOT_FOUND');
  return { groupRow, account, event, intent: event.canonical_intent, runtimeGroupId: String(groupRow.runtime_group_id) };
}

function syntheticClosedLeg(index, target, lot, stopLoss, nowMs) {
  return {
    legId: `leg-${index}`,
    targetIndex: index,
    lots: 0,
    requestedLots: lot,
    executedLots: 0,
    stopLoss,
    takeProfit: target,
    status: 'CLOSED',
    closedAt: nowMs,
    actionType: 'REPAIR_SKIPPED_PASSED_TARGET',
  };
}

function ensureLeg(group, leg) {
  const index = Number(leg.targetIndex);
  const current = Array.isArray(group.legs) ? group.legs : [];
  const existingIndex = current.findIndex((item) => Number(item.targetIndex) === index);
  if (existingIndex >= 0) {
    const next = [...current];
    next[existingIndex] = { ...current[existingIndex], ...leg, legId: current[existingIndex].legId };
    group.legs = next;
  } else {
    group.legs = [...current, leg].sort((a, b) => Number(a.targetIndex) - Number(b.targetIndex));
  }
}

async function controlsAllowLive(env, supabase) {
  const [trading, broker, live] = await Promise.all([
    resolveTradingAccessRuntimeControl({ env, supabase }),
    resolveBrokerExecutionRuntimeControl({ env, supabase }),
    resolveLiveBrokerExecutionRuntimeControl({ env, supabase }),
  ]);
  return trading?.ok === true && trading.enabled === true
    && broker?.ok === true && broker.enabled === true
    && live?.ok === true && live.enabled === true;
}

async function executeOne({ env, supabase, workspaceId, eventId, accountId, groupId, action }) {
  const dependencies = await createProductionExecutionDependencies({ env, supabase, workspaceId, tradingEventId: eventId });
  const stateBinder = createProductionTradeStateBinder({ env, workspaceId });
  const result = await executeProductionPlan({
    workspaceId,
    eventId,
    accountPlans: [{ accountId, groupId, actions: [action] }],
    brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: true,
    liveBrokerExecutionControlAvailable: true,
  }, { ...dependencies, stateBinder });
  const accountResult = result?.accounts?.[0];
  if (accountResult?.status !== 'SUCCEEDED') {
    const error = new Error(accountResult?.reason || result?.status || 'REPAIR_BROKER_ACTION_FAILED');
    error.result = result;
    throw error;
  }
  return result;
}

export async function repairLivePositionGroup({ env, supabase, workspaceId, groupId, confirmLive = false } = {}) {
  if (confirmLive !== true) return { ok: false, reason: 'LIVE_CONFIRMATION_REQUIRED' };
  if (!workspaceId || !groupId) return { ok: false, reason: 'WORKSPACE_AND_GROUP_REQUIRED' };
  if (!(await controlsAllowLive(env, supabase))) return { ok: false, reason: 'LIVE_EXECUTION_GATES_NOT_ENABLED' };

  const { account, event, intent, runtimeGroupId } = await loadGroupIntentAndAccount(supabase, workspaceId, groupId);
  if (account.environment !== 'live' || account.platform !== 'mt5' || account.provider_mode !== 'mt5_connector') {
    return { ok: false, reason: 'REPAIR_PROVIDER_NOT_SUPPORTED' };
  }
  if (account.is_active !== true || account.execution_enabled !== true || account.live_execution_enabled !== true) {
    return { ok: false, reason: 'ACCOUNT_EXECUTION_NOT_ENABLED' };
  }
  if (String(account.lot_sizing_type).toLowerCase() !== 'fixed') return { ok: false, reason: 'REPAIR_REQUIRES_FIXED_LOTS' };

  const state = tradeStateClient(env, workspaceId);
  let group = await state.getGroup(runtimeGroupId);
  if (!group) return { ok: false, reason: 'DURABLE_GROUP_NOT_FOUND' };

  const lotValue = finite(account.lot_value);
  const firstLeg = (group.legs || []).find((leg) => Number(leg.targetIndex) === 1);
  if (!firstLeg?.brokerPositionId && firstLeg?.status !== 'CLOSED') {
    return { ok: false, reason: 'ORIGINAL_BROKER_POSITION_UNAVAILABLE' };
  }

  let context = await loadMt5ConnectorContext({ env, account, symbol: group.symbol });
  let marketPrice = closeSidePrice(group.side, context.tick);
  let decision = buildLiveRepairDecision({ group, intent, marketPrice, lotValue });
  if (!decision.ok) return decision;

  const eventId = String(event.id);
  const accountId = String(account.id);

  if (firstLeg?.status !== 'CLOSED') {
    const firstAction = decision.passedCount >= 1
      ? {
          type: 'CLOSE_POSITION',
          symbol: group.symbol,
          brokerPositionId: firstLeg.brokerPositionId,
          lots: finite(firstLeg.lots) || lotValue,
          legId: firstLeg.legId,
          targetIndex: 1,
          idempotencyKey: `repair:${group.id}:target:1:close-passed`,
        }
      : {
          type: 'MODIFY_POSITION',
          symbol: group.symbol,
          brokerPositionId: firstLeg.brokerPositionId,
          stopLoss: decision.stopLoss,
          takeProfit: decision.targets[0],
          legId: firstLeg.legId,
          targetIndex: 1,
          idempotencyKey: `repair:${group.id}:target:1:protect`,
        };
    await executeOne({ env, supabase, workspaceId, eventId, accountId, groupId: group.id, action: firstAction });
  }

  group = await state.getGroup(runtimeGroupId);

  for (let index = 2; index <= decision.targets.length; index += 1) {
    context = await loadMt5ConnectorContext({ env, account, symbol: group.symbol });
    marketPrice = closeSidePrice(group.side, context.tick);
    decision = buildLiveRepairDecision({ group, intent, marketPrice, lotValue });
    if (!decision.ok) break;

    const target = decision.targets[index - 1];
    const currentLeg = (group.legs || []).find((leg) => Number(leg.targetIndex) === index);
    if (currentLeg?.brokerPositionId && ['OPEN', 'PENDING'].includes(String(currentLeg.status).toUpperCase())) continue;

    if (index <= decision.passedCount) {
      ensureLeg(group, syntheticClosedLeg(index, target, lotValue, decision.protectionStop, Date.now()));
      group.updatedAt = Date.now();
      await state.putGroup(group);
      continue;
    }

    const leg = {
      legId: currentLeg?.legId || `leg-${index}`,
      targetIndex: index,
      lots: lotValue,
      requestedLots: lotValue,
      stopLoss: decision.protectionStop,
      takeProfit: target,
      status: 'PLANNED',
    };
    ensureLeg(group, leg);
    group.status = 'OPEN';
    group.incomplete = false;
    group.updatedAt = Date.now();
    await state.putGroup(group);

    const action = {
      type: 'OPEN_POSITION',
      side: group.side,
      orderType: 'MARKET',
      symbol: group.symbol,
      entry: { kind: 'MARKET' },
      lots: lotValue,
      stopLoss: decision.protectionStop,
      takeProfit: target,
      legId: leg.legId,
      targetIndex: index,
      idempotencyKey: `repair:${group.id}:target:${index}:open`,
    };
    await executeOne({ env, supabase, workspaceId, eventId, accountId, groupId: group.id, action });
    group = await state.getGroup(runtimeGroupId);
  }

  group = await state.getGroup(runtimeGroupId);
  const openLike = (group.legs || []).some((leg) => ['OPEN', 'PENDING', 'PLANNED'].includes(String(leg.status).toUpperCase()));
  group.status = openLike ? 'OPEN' : 'CLOSED';
  group.incomplete = false;
  group.updatedAt = Date.now();
  await state.putGroup(group);

  return {
    ok: true,
    groupId: group.id,
    accountId,
    accountLabel: account.account_label,
    symbol: group.symbol,
    side: group.side,
    marketPrice,
    stopLoss: finite(intent.stopLoss),
    targets: decision.targets,
    passedTargets: decision.passedCount,
    protectionStop: decision.protectionStop,
    legs: (group.legs || []).map((leg) => ({
      targetIndex: leg.targetIndex,
      status: leg.status,
      lots: leg.lots,
      stopLoss: leg.stopLoss,
      takeProfit: leg.takeProfit,
      brokerPositionId: leg.brokerPositionId || null,
    })),
  };
}
