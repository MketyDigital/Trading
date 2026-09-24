import { buildExecutionPlan } from '../execution/execution_plan.js';
import { evaluateAccountPolicy } from '../execution/account_policy.js';
import { buildManagementActions } from '../execution/position_group.js';
import { buildEditedSignalManagement } from '../execution/source_edit_management.js';

function normalizeAccount(account = {}) {
  const sizingMode = account.sizingMode || (() => {
    const legacy = String(account.lot_sizing_type || '').toLowerCase();
    if (legacy === 'fixed') return 'FIXED_LOTS';
    if (legacy === 'adaptive_percent') return 'ADAPTIVE_PERCENT';
    if (legacy === 'symbol_equivalent') return 'SYMBOL_EQUIVALENT';
    if (legacy === 'balance_percent') return 'BALANCE_PERCENT';
    if (legacy === 'risk_percent') return 'RISK_PERCENT';
    if (legacy === 'fixed_risk') return 'FIXED_RISK';
    return undefined;
  })();

  return {
    ...account,
    sizingMode,
    fixedLots: account.fixedLots ?? (String(account.lot_sizing_type || '').toLowerCase() === 'fixed' ? account.lot_value : undefined),
    referenceLots: account.referenceLots ?? (['adaptive_percent','symbol_equivalent','balance_percent'].includes(String(account.lot_sizing_type || '').toLowerCase()) ? account.lot_value : undefined),
    adaptivePercent: account.adaptivePercent ?? account.lot_sizing_config?.percent ?? account.lotSizingConfig?.percent,
    riskPercent: account.riskPercent ?? account.risk_percent,
    riskAmount: account.riskAmount ?? account.risk_amount,
    safetyPolicy: account.safetyPolicy || account.safety_policy || { enabled: true, killSwitch: false },
    fastEntryPolicy: { enabled: true, mode: 'execute_immediately', locked: true },
  };
}

function simulationActions(actions = []) {
  return actions.map((action) => ({ ...action, simulated: true }));
}

function floorLotsToStep(value, step = 0.01) {
  const numeric = Number(value);
  const volumeStep = Number(step);
  if (!(numeric >= 0) || !(volumeStep > 0)) return undefined;
  const text = String(volumeStep);
  const precision = text.includes('.') ? text.split('.')[1].length : 0;
  return Number((Math.floor((numeric / volumeStep) + 1e-12) * volumeStep).toFixed(precision));
}

function buildPlannedSimulationManagementActions(group, management) {
  const plannedLegs = Array.isArray(group?.legs)
    ? group.legs.filter((leg) => leg?.status === 'PLANNED' && leg?.legId)
    : [];
  if (plannedLegs.length === 0) return [];

  if (management?.type === 'MOVE_SL_TO_BE') {
    if (!Number.isFinite(Number(group.entryPrice))) throw new Error('entryPrice is required for break-even');
    return plannedLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      symbol: group.symbol,
      stopLoss: Number(group.entryPrice),
    }));
  }

  if (management?.type === 'MOVE_SL') {
    const stopLoss = Number(management.stopLoss);
    if (!Number.isFinite(stopLoss)) throw new Error('finite stopLoss is required');
    return plannedLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      symbol: group.symbol,
      stopLoss,
    }));
  }

  if (management?.type === 'CHANGE_TP') {
    const takeProfit = Number(management.takeProfit);
    if (!Number.isFinite(takeProfit)) throw new Error('finite takeProfit is required');
    const targetIndex = management.targetIndex == null ? null : Number(management.targetIndex);
    const matchingLegs = targetIndex == null
      ? plannedLegs
      : plannedLegs.filter((leg) => Number(leg.targetIndex) === targetIndex);
    return matchingLegs.map((leg) => ({
      type: 'MODIFY_POSITION',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      symbol: group.symbol,
      takeProfit,
    }));
  }

  if (management?.type === 'CLOSE_PARTIAL') {
    const fraction = Number(management.fraction);
    const volumeStep = Number(management.volumeStep || 0.01);
    if (!(fraction > 0 && fraction <= 1)) throw new Error('partial-close fraction must be > 0 and <= 1');
    if (!(volumeStep > 0)) throw new Error('partial-close volumeStep must be positive');
    return plannedLegs.map((leg) => {
      let lots;
      if (leg.lots != null) {
        lots = floorLotsToStep(Number(leg.lots) * fraction, volumeStep);
        if (!(lots > 0) || lots >= Number(leg.lots)) {
          throw new Error('partial-close volume is not representable without full close');
        }
      }
      return {
        type: 'CLOSE_PARTIAL',
        legId: leg.legId,
        targetIndex: leg.targetIndex,
        symbol: group.symbol,
        fraction,
        lots,
      };
    });
  }

  if (management?.type === 'CANCEL_PENDING') {
    const orderType = String(group?.orderType || '').toUpperCase();
    if (!orderType || orderType === 'MARKET') return [];
    return plannedLegs.map((leg) => ({
      type: 'CANCEL_PENDING',
      legId: leg.legId,
      targetIndex: leg.targetIndex,
      symbol: group.symbol,
      orderType,
    }));
  }

  return [];
}

function buildSimulationManagementActions(group, management) {
  const brokerBound = buildManagementActions(group, management);
  if (brokerBound.length > 0) return brokerBound;
  return buildPlannedSimulationManagementActions(group, management);
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

function finitePositive(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function fastCompletionProtectionReference(group, currentMarketPrice) {
  return finitePositive(group?.entryPrice)
    ?? finitePositive(group?.entry?.executedPrice)
    ?? finitePositive(group?.legs?.find((leg) => leg?.status === 'OPEN')?.fillPrice)
    ?? finitePositive(currentMarketPrice);
}

function protectionValueValidAtMarket(side, kind, value, currentMarketPrice) {
  const price = finitePositive(value);
  const market = finitePositive(currentMarketPrice);
  if (price == null || market == null) return price != null;
  if (kind === 'stopLoss') return side === 'BUY' ? price < market : price > market;
  if (kind === 'takeProfit') return side === 'BUY' ? price > market : price < market;
  return false;
}

function reconcilePlannedFastEntry(existing, plan, { event, eventId, account, nowMs, currentMarketPrice }) {
  const desired = plannedStateGroup({ ...plan, intent: plan.intent }, {
    event,
    eventId,
    account,
    nowMs,
  });
  desired.id = existing.id;
  desired.createdAt = existing.createdAt ?? nowMs;
  const preservedEntryPrice = finitePositive(existing.entryPrice)
    ?? finitePositive(existing.entry?.executedPrice)
    ?? finitePositive(existing.legs?.find((leg) => leg?.status === 'OPEN')?.fillPrice);
  if (preservedEntryPrice != null) desired.entryPrice = preservedEntryPrice;
  if (existing.entry && typeof existing.entry === 'object') desired.entry = { ...existing.entry };
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

  const currentPrice = finitePositive(currentMarketPrice);
  const side = String(desired.side || '').toUpperCase();
  const originalStopValid = desiredFirst.stopLoss == null
    || protectionValueValidAtMarket(side, 'stopLoss', desiredFirst.stopLoss, currentPrice);
  const originalTargetValid = desiredFirst.takeProfit == null
    || protectionValueValidAtMarket(side, 'takeProfit', desiredFirst.takeProfit, currentPrice);

  if (!originalStopValid) desired.legs[0].stopLoss = existingFirst.stopLoss ?? null;
  if (!originalTargetValid) desired.legs[0].takeProfit = existingFirst.takeProfit ?? null;

  const modify = {
    type: 'MODIFY_POSITION',
    legId: existingFirst.legId,
    brokerPositionId: existingFirst.brokerPositionId,
    symbol: desired.symbol,
    targetIndex: 1,
    idempotencyKey: `${existing.id}:leg:1:complete`,
  };
  if (originalStopValid && desiredFirst.stopLoss != null) modify.stopLoss = desiredFirst.stopLoss;
  if (originalTargetValid && desiredFirst.takeProfit != null) modify.takeProfit = desiredFirst.takeProfit;

  const followupOpens = plan.actions.slice(1)
    .filter((action) => {
      const stopValid = action.stopLoss == null
        || protectionValueValidAtMarket(side, 'stopLoss', action.stopLoss, currentPrice);
      const targetValid = action.takeProfit == null
        || protectionValueValidAtMarket(side, 'takeProfit', action.takeProfit, currentPrice);
      return stopValid && targetValid;
    })
    .map((action) => ({
      ...action,
      idempotencyKey: `${existing.id}:leg:${action.targetIndex}`,
    }));

  const allowedTargetIndexes = new Set([
    Number(existingFirst.targetIndex ?? 1),
    ...followupOpens.map((action) => Number(action.targetIndex)),
  ]);
  desired.legs = desired.legs.filter((leg) => allowedTargetIndexes.has(Number(leg.targetIndex)));

  const hasModifyProtection = Object.hasOwn(modify, 'stopLoss') || Object.hasOwn(modify, 'takeProfit');
  const actions = [...(hasModifyProtection ? [modify] : []), ...followupOpens];

  return { group: desired, actions };
}

function managementAuditGroup(group, event, nowMs, management = null) {
  const next = {
    ...group,
    legs: Array.isArray(group?.legs) ? group.legs.map((leg) => ({ ...leg })) : [],
    sourceEventIds: [...new Set([
      ...(group.sourceEventIds || []).map(String),
      ...(event?.external_event_id != null ? [String(event.external_event_id)] : []),
    ])],
    updatedAt: Number(nowMs),
  };

  if (management?.type === 'TARGET_HIT') {
    const hitIndex = Number(management.targetIndex);
    if (Number.isInteger(hitIndex) && hitIndex >= 1) {
      next.legs = next.legs.map((leg) => {
        const targetIndex = Number(leg.targetIndex);
        if (!Number.isInteger(targetIndex) || targetIndex > hitIndex) return leg;
        return {
          ...leg,
          status: 'CLOSED',
          lots: 0,
          closedAt: leg.closedAt ?? Number(nowMs),
        };
      });
      if (!next.legs.some((leg) => ['OPEN', 'PENDING', 'PLANNED'].includes(String(leg.status).toUpperCase()))) {
        next.status = 'CLOSED';
      }
    }
  }

  return next;
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
  const loaded = await loadMatchedFastGroups(correlation, stateStore);
  if (!loaded.ok) {
    return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: loaded.reason };
  }

  const accounts = await accountProvider(event.workspace_hint, event, interpretation);
  const accountById = new Map((Array.isArray(accounts) ? accounts : [])
    .map((account) => [String(account?.id ?? ''), account])
    .filter(([id]) => Boolean(id)));

  for (const matchedGroup of loaded.groups) {
    if (!accountById.has(String(matchedGroup.tradeAccountId ?? ''))) {
      return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: 'MATCHED_ACCOUNT_NOT_FOUND' };
    }
  }

  const results = [];
  const stagedGroups = [];

  for (const matchedGroup of loaded.groups) {
    const account = normalizeAccount(accountById.get(String(matchedGroup.tradeAccountId)));
    if (account.execution_enabled !== true && account.executionEnabled !== true) {
      results.push({ accountId: account.id, status: 'SKIPPED', reason: 'EXECUTION_DISABLED', actions: [] });
      continue;
    }

    if (interpretation.management?.type === 'TARGET_HIT' && account.safetyPolicy?.autoTpProtection !== true) {
      results.push({ accountId: account.id, status: 'SKIPPED', reason: 'AUTO_TP_PROTECTION_DISABLED', actions: [] });
      continue;
    }

    const policy = evaluateAccountPolicy(account.safetyPolicy, {
      symbol: matchedGroup.symbol,
      actionKind: 'REDUCE_RISK',
    });
    if (!policy.allowed) {
      results.push({ accountId: account.id, status: 'BLOCKED', policy, actions: [] });
      continue;
    }

    let actions;
    try {
      actions = buildSimulationManagementActions(matchedGroup, interpretation.management);
    } catch (error) {
      results.push({
        accountId: account.id,
        status: 'BLOCKED',
        reason: 'MANAGEMENT_ACTION_INVALID',
        error: error.message,
        policy,
        actions: [],
      });
      continue;
    }

    if (!Array.isArray(actions) || actions.length === 0) {
      const protectionAlreadyApplied = ['TARGET_HIT', 'MOVE_SL_TO_BE'].includes(String(interpretation.management?.type || '').toUpperCase());
      if (protectionAlreadyApplied) {
        stagedGroups.push(managementAuditGroup(matchedGroup, event, nowMs, interpretation.management));
        results.push({
          accountId: account.id,
          status: 'SKIPPED',
          reason: interpretation.management?.type === 'TARGET_HIT'
            ? 'TARGET_PROTECTION_ALREADY_APPLIED'
            : 'BREAK_EVEN_ALREADY_APPLIED',
          policy,
          actions: [],
        });
        continue;
      }
      results.push({
        accountId: account.id,
        status: 'BLOCKED',
        reason: 'MANAGEMENT_ACTION_UNAVAILABLE',
        policy,
        actions: [],
      });
      continue;
    }

    stagedGroups.push(managementAuditGroup(matchedGroup, event, nowMs, interpretation.management));
    results.push({
      accountId: account.id,
      status: 'READY',
      groupId: matchedGroup.id,
      policy,
      actions: simulationActions(actions),
    });
  }

  for (const group of stagedGroups) {
    await stateStore.putGroup(group);
  }

  return {
    ...base,
    status: 'SIMULATED',
    correlation,
    accounts: results,
  };
}

async function orchestrateMatchedEdit({
  event,
  interpretation,
  nowMs,
  correlation,
  stateStore,
  accountProvider,
}) {
  const base = { executionEnabled: false, actions: [] };
  const loaded = await loadMatchedFastGroups(correlation, stateStore);
  if (!loaded.ok) {
    return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: loaded.reason };
  }

  const accounts = await accountProvider(event.workspace_hint, event, interpretation);
  const accountById = new Map((Array.isArray(accounts) ? accounts : [])
    .map((account) => [String(account?.id ?? ''), account])
    .filter(([id]) => Boolean(id)));

  for (const matchedGroup of loaded.groups) {
    if (!accountById.has(String(matchedGroup.tradeAccountId ?? ''))) {
      return { ...base, status: 'BLOCKED', correlation, accounts: [], reason: 'MATCHED_ACCOUNT_NOT_FOUND' };
    }
  }

  const diffs = loaded.groups.map((matchedGroup) => ({
    matchedGroup,
    diff: buildEditedSignalManagement(matchedGroup, interpretation.intent, { rawText: event.text }),
  }));
  const unsafe = diffs.find(({ diff }) => diff.status === 'NEEDS_REVIEW');
  if (unsafe) {
    return {
      ...base,
      status: 'NEEDS_REVIEW',
      correlation,
      accounts: [],
      reason: unsafe.diff.reason || 'EDIT_MANAGEMENT_UNSAFE',
    };
  }

  const results = [];
  const stagedGroups = [];
  for (const { matchedGroup, diff } of diffs) {
    const account = normalizeAccount(accountById.get(String(matchedGroup.tradeAccountId)));
    if (account.execution_enabled !== true && account.executionEnabled !== true) {
      results.push({ accountId: account.id, status: 'SKIPPED', reason: 'EXECUTION_DISABLED', actions: [] });
      continue;
    }

    if (diff.status === 'NO_ACTION') {
      results.push({ accountId: account.id, status: 'SKIPPED', reason: diff.reason, actions: [] });
      continue;
    }

    const policy = evaluateAccountPolicy(account.safetyPolicy, {
      symbol: matchedGroup.symbol,
      actionKind: 'REDUCE_RISK',
    });
    if (!policy.allowed) {
      results.push({ accountId: account.id, status: 'BLOCKED', policy, actions: [] });
      continue;
    }

    stagedGroups.push(managementAuditGroup(matchedGroup, event, nowMs));
    results.push({
      accountId: account.id,
      status: 'READY',
      groupId: matchedGroup.id,
      policy,
      actions: simulationActions(diff.actions),
    });
  }

  for (const group of stagedGroups) {
    await stateStore.putGroup(group);
  }

  return {
    ...base,
    status: 'SIMULATED',
    correlation,
    accounts: results,
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

function needsPlanningMarketPrice(account = {}, intent = {}) {
  const sizingMode = String(account?.sizingMode ?? '').trim().toUpperCase();
  const takeProfits = Array.isArray(intent?.takeProfits) ? intent.takeProfits : [];
  const bareFastMarket = intent?.fastEntry === true
    && intent?.incomplete === true
    && String(intent?.entry?.kind || '').toUpperCase() === 'MARKET'
    && intent?.stopLoss == null
    && takeProfits.length === 0;

  // A fixed-lot bare fast entry has no price-dependent protection or risk
  // geometry. Requiring a broker quote here creates an unnecessary single
  // point of failure and can prevent the durable fast group from existing for
  // the full follow-up. Protected/range/risk-sized trades still require the
  // broker-authoritative market context.
  return !(bareFastMarket && (sizingMode === 'FIXED_LOTS' || sizingMode === 'ADAPTIVE_PERCENT' || sizingMode === 'MARGIN_EQUIVALENT'));
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

  const isEdit = isSignal && correlation?.status === 'MATCHED' && correlation?.reason === 'EDIT_TARGET';
  if (isEdit) {
    return orchestrateMatchedEdit({
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

    let instrument;
    let exposure;
    let currentMarketPrice;
    try {
      instrument = await instrumentProvider(account, interpretation.intent, event);
      if (!instrument) throw new Error('instrument metadata unavailable');
      exposure = await exposureProvider(account, interpretation.intent, event) || {};
      currentMarketPrice = needsPlanningMarketPrice(account, interpretation.intent)
        ? await marketPriceProvider(account, interpretation.intent, instrument, event)
        : undefined;
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
        ...(matchedGroup ? {
          protectionReferencePrice: fastCompletionProtectionReference(matchedGroup, currentMarketPrice),
        } : {}),
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
        protectionIssues: plan.protectionIssues ?? [],
        protectionSkips: plan.protectionSkips ?? [],
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
          currentMarketPrice,
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
        protectionIssues: plan.protectionIssues ?? [],
        protectionSkips: plan.protectionSkips ?? [],
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
      protectionIssues: plan.protectionIssues ?? [],
      protectionSkips: plan.protectionSkips ?? [],
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
