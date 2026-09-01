import { buildExecutionPlan } from '../execution/execution_plan.js';
import { evaluateAccountPolicy } from '../execution/account_policy.js';
import { buildManagementActions } from '../execution/position_group.js';

function normalizeAccount(account = {}) {
  const sizingMode = account.sizingMode || (() => {
    const legacy = String(account.lot_sizing_type || '').toLowerCase();
    if (legacy === 'fixed') return 'FIXED_LOTS';
    if (legacy === 'risk_percent') return 'RISK_PERCENT';
    if (legacy === 'fixed_risk') return 'FIXED_RISK';
    return undefined;
  })();

  return {
    ...account,
    sizingMode,
    fixedLots: account.fixedLots ?? (String(account.lot_sizing_type || '').toLowerCase() === 'fixed' ? account.lot_value : undefined),
    riskPercent: account.riskPercent ?? account.risk_percent,
    riskAmount: account.riskAmount ?? account.risk_amount,
    safetyPolicy: account.safetyPolicy || account.safety_policy || { enabled: true, killSwitch: false },
  };
}

function simulationActions(actions = []) {
  return actions.map((action) => ({ ...action, simulated: true }));
}

function plannedStateGroup(plan, { event, eventId, account, nowMs }) {
  return {
    ...plan.group,
    id: plan.group.id,
    workspaceId: event.workspace_hint ?? account.workspace_id ?? null,
    tradeAccountId: account.id,
    sourceEventId: eventId ?? null,
    sourceInstanceId: String(event?.source?.instance_id ?? ''),
    sourceEventIds: event?.external_event_id != null ? [String(event.external_event_id)] : [],
    threadId: event?.thread?.thread_id != null ? String(event.thread.thread_id) : null,
    incomplete: Boolean(plan?.group?.incomplete ?? false) || Boolean(plan?.intent?.incomplete ?? false),
    positionMode: account.positionMode || account.position_mode || 'HEDGED',
    riskPlan: plan.risk ?? null,
    policySnapshot: plan.policy ?? null,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
}

function reconcilePlannedFastEntry(existing, plan, { event, eventId, account, nowMs }) {
  const desired = plannedStateGroup({ ...plan, intent: plan.intent }, {
    event,
    eventId,
    account,
    nowMs,
  });
  desired.id = existing.id;
  desired.createdAt = existing.createdAt ?? nowMs;
  desired.sourceEventIds = [...new Set([
    ...(existing.sourceEventIds || []).map(String),
    ...(event?.external_event_id != null ? [String(event.external_event_id)] : []),
  ])];
  desired.incomplete = false;

  const existingFirst = existing.legs?.[0];
  const desiredFirst = desired.legs?.[0];
  if (!existingFirst || !desiredFirst) throw new Error('existing fast-entry leg is unavailable');

  desired.legs[0] = {
    ...existingFirst,
    ...desiredFirst,
    legId: existingFirst.legId,
    brokerPositionId: existingFirst.brokerPositionId,
    brokerOrderId: existingFirst.brokerOrderId,
    status: existingFirst.status,
  };

  const actions = [{
    type: 'MODIFY_POSITION',
    legId: existingFirst.legId,
    brokerPositionId: existingFirst.brokerPositionId,
    symbol: desired.symbol,
    stopLoss: desiredFirst.stopLoss,
    takeProfit: desiredFirst.takeProfit,
    targetIndex: 1,
    idempotencyKey: `${existing.id}:leg:1:complete`,
  }, ...plan.actions.slice(1).map((action) => ({
    ...action,
    idempotencyKey: `${existing.id}:leg:${action.targetIndex}`,
  }))];

  return { group: desired, actions };
}

function managementAuditGroup(group, event, nowMs) {
  return {
    ...group,
    sourceEventIds: [...new Set([
      ...(group.sourceEventIds || []).map(String),
      ...(event?.external_event_id != null ? [String(event.external_event_id)] : []),
    ])],
    updatedAt: Number(nowMs),
  };
}

async function orchestrateMatchedManagement({
  event,
  interpretation,
  nowMs,
  correlation,
  stateStore,
  accountProvider,
}) {
  const base = { executionEnabled: false, actions: [] };
  if (!stateStore?.getGroup) {
    return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: 'MATCHED_GROUP_STORE_UNAVAILABLE' };
  }

  const matchedGroup = await stateStore.getGroup(correlation.groupId);
  if (!matchedGroup) {
    return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: 'MATCHED_GROUP_NOT_FOUND' };
  }

  const accounts = await accountProvider(event.workspace_hint, event, interpretation);
  const rawAccount = (Array.isArray(accounts) ? accounts : [])
    .find((account) => String(account?.id) === String(matchedGroup.tradeAccountId));
  if (!rawAccount) {
    return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: 'MATCHED_ACCOUNT_NOT_FOUND' };
  }

  const account = normalizeAccount(rawAccount);
  if (account.execution_enabled !== true && account.executionEnabled !== true) {
    return {
      ...base,
      status: 'SIMULATED',
      correlation,
      accounts: [{ accountId: account.id, status: 'SKIPPED', reason: 'EXECUTION_DISABLED', actions: [] }],
    };
  }

  const policy = evaluateAccountPolicy(account.safetyPolicy, {
    symbol: matchedGroup.symbol,
    actionKind: 'REDUCE_RISK',
  });
  if (!policy.allowed) {
    return {
      ...base,
      status: 'SIMULATED',
      correlation,
      accounts: [{ accountId: account.id, status: 'BLOCKED', policy, actions: [] }],
    };
  }

  let actions;
  try {
    actions = buildManagementActions(matchedGroup, interpretation.management);
  } catch (error) {
    return {
      ...base,
      status: 'SIMULATED',
      correlation,
      accounts: [{
        accountId: account.id,
        status: 'BLOCKED',
        reason: 'MANAGEMENT_ACTION_INVALID',
        error: error.message,
        policy,
        actions: [],
      }],
    };
  }

  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      ...base,
      status: 'SIMULATED',
      correlation,
      accounts: [{
        accountId: account.id,
        status: 'BLOCKED',
        reason: 'MANAGEMENT_ACTION_UNAVAILABLE',
        policy,
        actions: [],
      }],
    };
  }

  const auditedGroup = managementAuditGroup(matchedGroup, event, nowMs);
  await stateStore.putGroup(auditedGroup);

  return {
    ...base,
    status: 'SIMULATED',
    correlation,
    accounts: [{
      accountId: account.id,
      status: 'READY',
      groupId: matchedGroup.id,
      policy,
      actions: simulationActions(actions),
    }],
  };
}

function matchedFastGroupIds(correlation = {}) {
  if (Array.isArray(correlation.groupIds) && correlation.groupIds.length) {
    return [...new Set(correlation.groupIds.map(String).filter(Boolean))];
  }
  return correlation.groupId != null && String(correlation.groupId) !== ''
    ? [String(correlation.groupId)]
    : [];
}

async function loadMatchedFastGroups(correlation, stateStore) {
  if (!stateStore?.getGroup) {
    return { ok: false, reason: 'MATCHED_GROUP_STORE_UNAVAILABLE', groups: [] };
  }
  const groupIds = matchedFastGroupIds(correlation);
  if (groupIds.length === 0) {
    return { ok: false, reason: 'MATCHED_GROUP_NOT_FOUND', groups: [] };
  }

  const groups = [];
  const accountIds = new Set();
  for (const groupId of groupIds) {
    const group = await stateStore.getGroup(groupId);
    if (!group) return { ok: false, reason: 'MATCHED_GROUP_NOT_FOUND', groups: [] };
    const accountId = String(group.tradeAccountId ?? '');
    if (!accountId || accountIds.has(accountId)) {
      return { ok: false, reason: 'AMBIGUOUS_MATCHED_ACCOUNT_GROUPS', groups: [] };
    }
    accountIds.add(accountId);
    groups.push(group);
  }

  return { ok: true, groups };
}

export async function orchestrateTradingEventSimulation({
  event = {},
  interpretation = {},
  eventId = null,
  nowMs = Date.now(),
} = {}, {
  stateCoordinator,
  stateStore,
  accountProvider,
  instrumentProvider,
  exposureProvider = async () => ({}),
  marketPriceProvider = async () => undefined,
} = {}) {
  if (!stateCoordinator?.correlate) throw new TypeError('stateCoordinator is required');
  if (!stateStore?.putGroup) throw new TypeError('stateStore is required');
  if (typeof accountProvider !== 'function') throw new TypeError('accountProvider is required');
  if (typeof instrumentProvider !== 'function') throw new TypeError('instrumentProvider is required');

  // This service is intentionally simulation-only. It accepts no broker executor
  // dependency and never dispatches a destination or broker command.
  const base = { executionEnabled: false, actions: [] };
  const isSignal = interpretation.status === 'READY' && interpretation.intent;
  const isManagement = interpretation.status === 'MANAGEMENT' && interpretation.management;

  if (!isSignal && !isManagement) {
    return { ...base, status: interpretation.status || 'NO_ACTION', correlation: null, accounts: [] };
  }

  const correlation = await stateCoordinator.correlate(event, interpretation, nowMs);
  if (correlation?.status === 'NEEDS_REVIEW') {
    return { ...base, status: 'NEEDS_REVIEW', correlation, accounts: [] };
  }

  if (isManagement) {
    if (correlation?.status !== 'MATCHED') {
      return { ...base, status: 'CORRELATED', correlation, accounts: [] };
    }
    return orchestrateMatchedManagement({
      event,
      interpretation,
      nowMs,
      correlation,
      stateStore,
      accountProvider,
    });
  }

  const isFastCompletion = correlation?.status === 'MATCHED' && correlation?.reason === 'FAST_ENTRY_COMPLETION';
  if (correlation?.status !== 'NEW_GROUP' && !isFastCompletion) {
    return { ...base, status: 'CORRELATED', correlation, accounts: [] };
  }

  let matchedByAccount = new Map();
  if (isFastCompletion) {
    const loaded = await loadMatchedFastGroups(correlation, stateStore);
    if (!loaded.ok) {
      return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: loaded.reason };
    }
    matchedByAccount = new Map(loaded.groups.map((group) => [String(group.tradeAccountId), group]));
  }

  const accounts = await accountProvider(event.workspace_hint, event, interpretation);
  const results = [];

  for (const rawAccount of Array.isArray(accounts) ? accounts : []) {
    const account = normalizeAccount(rawAccount);
    const matchedGroup = isFastCompletion ? matchedByAccount.get(String(account.id)) || null : null;

    if (account.execution_enabled !== true && account.executionEnabled !== true) {
      results.push({ accountId: account.id, status: 'SKIPPED', reason: 'EXECUTION_DISABLED', actions: [] });
      continue;
    }

    if (interpretation.intent.fastEntry === true) {
      const policy = String(account.fast_entry_policy || account.fastEntryPolicy || 'wait_for_complete_signal');
      if (policy === 'forward_only') {
        results.push({ accountId: account.id, status: 'SKIPPED', reason: 'FAST_ENTRY_FORWARD_ONLY', actions: [] });
        continue;
      }
      if (policy === 'wait_for_complete_signal') {
        results.push({ accountId: account.id, status: 'WAITING', reason: 'WAIT_FOR_COMPLETE_SIGNAL', actions: [] });
        continue;
      }
    }

    let instrument;
    let exposure;
    let currentMarketPrice;
    try {
      instrument = await instrumentProvider(account, interpretation.intent, event);
      if (!instrument) throw new Error('instrument metadata unavailable');
      exposure = await exposureProvider(account, interpretation.intent, event) || {};
      currentMarketPrice = await marketPriceProvider(account, interpretation.intent, instrument, event);
    } catch (error) {
      results.push({ accountId: account.id, status: 'BLOCKED', reason: 'MARKET_CONTEXT_UNAVAILABLE', error: error.message, actions: [] });
      continue;
    }

    let plan;
    const groupId = matchedGroup?.id || `${eventId || event.external_event_id || 'event'}:${account.id}`;
    try {
      plan = buildExecutionPlan(interpretation.intent, {
        account,
        instrument,
        currentMarketPrice,
        groupId,
        exposure,
      });
    } catch (error) {
      results.push({ accountId: account.id, status: 'BLOCKED', reason: 'EXECUTION_PLAN_INVALID', error: error.message, actions: [] });
      continue;
    }

    if (plan.status !== 'READY') {
      results.push({
        accountId: account.id,
        status: 'BLOCKED',
        policy: plan.policy,
        risk: plan.risk,
        actions: [],
      });
      continue;
    }

    if (matchedGroup) {
      let reconciliation;
      try {
        reconciliation = reconcilePlannedFastEntry(matchedGroup, { ...plan, intent: interpretation.intent }, {
          event,
          eventId,
          account,
          nowMs: Number(nowMs),
        });
      } catch (error) {
        results.push({ accountId: account.id, status: 'BLOCKED', reason: 'FAST_ENTRY_RECONCILIATION_FAILED', error: error.message, actions: [] });
        continue;
      }

      await stateStore.putGroup(reconciliation.group);
      results.push({
        accountId: account.id,
        status: 'READY',
        groupId: reconciliation.group.id,
        policy: plan.policy,
        risk: plan.risk,
        actions: simulationActions(reconciliation.actions),
      });
      continue;
    }

    const group = plannedStateGroup({ ...plan, intent: interpretation.intent }, {
      event,
      eventId,
      account,
      nowMs: Number(nowMs),
    });
    group.incomplete = Boolean(interpretation.intent.incomplete);
    await stateStore.putGroup(group);

    results.push({
      accountId: account.id,
      status: 'READY',
      groupId: group.id,
      policy: plan.policy,
      risk: plan.risk,
      actions: simulationActions(plan.actions),
    });
  }

  return {
    ...base,
    status: 'SIMULATED',
    correlation,
    accounts: results,
  };
}
