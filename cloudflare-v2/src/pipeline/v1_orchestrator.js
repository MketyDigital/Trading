import { buildExecutionPlan } from '../execution/execution_plan.js';

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

  if (interpretation.status !== 'READY' || !interpretation.intent) {
    return { ...base, status: interpretation.status || 'NO_ACTION', correlation: null, accounts: [] };
  }

  const correlation = await stateCoordinator.correlate(event, interpretation, nowMs);
  if (correlation?.status !== 'NEW_GROUP') {
    return {
      ...base,
      status: correlation?.status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'CORRELATED',
      correlation,
      accounts: [],
    };
  }

  const accounts = await accountProvider(event.workspace_hint, event, interpretation);
  const results = [];

  for (const rawAccount of Array.isArray(accounts) ? accounts : []) {
    const account = normalizeAccount(rawAccount);

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
    const groupId = `${eventId || event.external_event_id || 'event'}:${account.id}`;
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
