function scopedGroups(activeGroups, event) {
  const sourceInstanceId = String(event?.source?.instance_id ?? '');
  const workspaceId = event?.workspace_hint == null ? '' : String(event.workspace_hint);
  return (activeGroups || []).filter((group) => {
    if (!group || !['OPEN', 'PLANNED', 'PENDING'].includes(String(group.status || 'OPEN'))) return false;
    if (workspaceId && String(group.workspaceId ?? '') !== workspaceId) return false;
    if (sourceInstanceId && String(group.sourceInstanceId ?? '') !== sourceInstanceId) return false;
    return true;
  });
}

function activeRecentGroups(activeGroups, event, nowMs, windowMs) {
  return scopedGroups(activeGroups, event).filter((group) => {
    const updatedAt = Number(group.updatedAt ?? group.createdAt ?? 0);
    return updatedAt > 0 && nowMs - updatedAt <= windowMs;
  });
}

function fastCompletionEligibleGroups(groups, nowMs, windowMs) {
  return (groups || []).filter((group) => {
    const originatedAt = Number(group.createdAt ?? group.updatedAt ?? 0);
    return originatedAt > 0 && Number(nowMs) - originatedAt <= Number(windowMs);
  });
}

function isDuplicateSourceEvent(groups, event) {
  const externalEventId = event?.external_event_id == null ? '' : String(event.external_event_id);
  if (!externalEventId) return false;
  return groups.some((group) => (group.sourceEventIds || []).map(String).includes(externalEventId));
}

function fastOriginId(group) {
  const first = Array.isArray(group?.sourceEventIds) ? group.sourceEventIds[0] : null;
  return first == null || String(first) === '' ? null : String(first);
}

function logicalTradeKey(group) {
  return fastOriginId(group) || (group?.id == null ? '' : String(group.id));
}

function logicalCohorts(groups = []) {
  const byKey = new Map();
  for (const group of groups) {
    const key = logicalTradeKey(group);
    if (!key) continue;
    const cohort = byKey.get(key) || [];
    cohort.push(group);
    byKey.set(key, cohort);
  }
  return [...byKey.values()];
}

function cohortUpdatedAt(cohort = []) {
  return Math.max(0, ...cohort.map((group) => Number(group?.updatedAt ?? group?.createdAt ?? 0)).filter(Number.isFinite));
}

function targetForCohort(cohort = [], reason = 'MATCHED') {
  if (cohort.length === 1) return { status: 'MATCHED', reason, groupId: cohort[0].id };
  if (cohort.length > 1 && sameLogicalTrade(cohort)) {
    return { status: 'MATCHED', reason, groupIds: cohort.map((group) => group.id) };
  }
  return null;
}

function correlateFastCompletion(matches) {
  if (matches.length === 1) {
    return { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: matches[0].id };
  }
  if (matches.length < 2) return null;

  const origins = matches.map(fastOriginId);
  if (origins.some((origin) => !origin) || new Set(origins).size !== 1) {
    return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_FAST_ENTRY_COMPLETION' };
  }

  return {
    status: 'MATCHED',
    reason: 'FAST_ENTRY_COMPLETION',
    groupIds: matches.map((group) => group.id),
  };
}

function managementSymbol(interpretration = {}) {
  return String(interpretration?.management?.symbol?.canonical ?? '').trim().toUpperCase();
}

function sameLogicalTrade(matches = []) {
  if (matches.length < 2) return false;
  const origins = matches.map(fastOriginId);
  if (origins.some((origin) => !origin) || new Set(origins).size !== 1) return false;

  const symbols = matches.map((group) => String(group?.symbol ?? '').trim().toUpperCase()).filter(Boolean);
  if (symbols.length && new Set(symbols).size !== 1) return false;

  const sides = matches.map((group) => String(group?.side ?? '').trim().toUpperCase()).filter(Boolean);
  if (sides.length && new Set(sides).size !== 1) return false;

  return true;
}

function matchedManagementTarget(matches, reason, ambiguousReason) {
  if (matches.length === 1) return { status: 'MATCHED', reason, groupId: matches[0].id };
  if (matches.length > 1 && sameLogicalTrade(matches)) {
    return { status: 'MATCHED', reason, groupIds: matches.map((group) => group.id) };
  }
  if (matches.length > 1) return { status: 'NEEDS_REVIEW', reason: ambiguousReason };
  return null;
}

function managementBrokerIdentity(interpretation = {}) {
  const management = interpretation?.management || {};
  const brokerPositionId = management.brokerPositionId ?? management.broker_position_id ?? management.positionId ?? management.position_id;
  const brokerOrderId = management.brokerOrderId ?? management.broker_order_id ?? management.orderId ?? management.order_id;
  return {
    brokerPositionId: brokerPositionId == null || String(brokerPositionId).trim() === '' ? null : String(brokerPositionId).trim(),
    brokerOrderId: brokerOrderId == null || String(brokerOrderId).trim() === '' ? null : String(brokerOrderId).trim(),
  };
}

function brokerIdentityTarget(groups = [], interpretation = {}) {
  const identity = managementBrokerIdentity(interpretation);
  if (!identity.brokerPositionId && !identity.brokerOrderId) return null;
  const matches = groups.filter((group) => (group?.legs || []).some((leg) => {
    if (identity.brokerPositionId && String(leg?.brokerPositionId ?? '') === identity.brokerPositionId) return true;
    if (identity.brokerOrderId && String(leg?.brokerOrderId ?? '') === identity.brokerOrderId) return true;
    return false;
  }));
  const target = matchedManagementTarget(matches, 'BROKER_IDENTITY_TARGET', 'AMBIGUOUS_BROKER_IDENTITY_TARGET');
  return target || { status: 'NEEDS_REVIEW', reason: 'NO_BROKER_IDENTITY_TARGET' };
}

function telegramMessageCoordinate(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(telegram:.+):(\d+)$/);
  if (!match) return null;
  const sequence = Number(match[2]);
  return Number.isSafeInteger(sequence) ? { channel: match[1], sequence } : null;
}

function sourceMessageContinuityTarget(groups = [], event = {}) {
  const current = telegramMessageCoordinate(event?.external_event_id);
  if (!current) return null;

  const cohorts = logicalCohorts(groups);
  const adjacent = cohorts.filter((cohort) => cohort.some((group) =>
    (group?.sourceEventIds || []).some((sourceEventId) => {
      const coordinate = telegramMessageCoordinate(sourceEventId);
      return coordinate?.channel === current.channel && coordinate.sequence === current.sequence - 1;
    })
  ));

  if (adjacent.length === 1) {
    return targetForCohort(adjacent[0], 'SOURCE_MESSAGE_CONTINUITY');
  }
  if (adjacent.length > 1) {
    return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' };
  }
  return null;
}

function activeLogicalTradeTarget(groups = [], { nowMs, windowMs, recencyGapMs = 5000 } = {}) {
  if (groups.length === 0) return null;
  const cohorts = logicalCohorts(groups);
  if (cohorts.length === 1) {
    return targetForCohort(cohorts[0], cohorts[0].length === 1 ? 'ONLY_ACTIVE_GROUP' : 'ONLY_ACTIVE_TRADE');
  }

  const recentCohorts = cohorts
    .map((cohort) => ({ cohort, updatedAt: cohortUpdatedAt(cohort) }))
    .filter((entry) => entry.updatedAt > 0 && Number(nowMs) - entry.updatedAt <= Number(windowMs))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (recentCohorts.length > 0) {
    const newest = recentCohorts[0];
    const runnerUp = recentCohorts[1];
    const clearlyNewest = !runnerUp || newest.updatedAt - runnerUp.updatedAt >= Number(recencyGapMs);
    if (clearlyNewest) {
      const target = targetForCohort(newest.cohort, 'RECENT_ACTIVE_TRADE');
      if (target) return target;
    }
  }

  return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' };
}

function recentFastDuplicateTarget(recent = [], intent = {}) {
  if (intent?.fastEntry !== true || intent?.incomplete !== true) return null;
  const symbol = String(intent?.symbol?.canonical ?? '').trim().toUpperCase();
  const side = String(intent?.side ?? '').trim().toUpperCase();
  if (!symbol || !side) return null;

  const matches = recent.filter((group) =>
    group?.incomplete === true
    && String(group?.symbol ?? '').trim().toUpperCase() === symbol
    && String(group?.side ?? '').trim().toUpperCase() === side
  );
  const cohorts = logicalCohorts(matches);
  if (cohorts.length !== 1) return null;
  const cohort = cohorts[0];
  return {
    status: 'NO_ACTION',
    reason: 'RECENT_FAST_ENTRY_DUPLICATE',
    ...(cohort.length === 1 ? { groupId: cohort[0].id } : { groupIds: cohort.map((group) => group.id) }),
  };
}

export function correlateTradingEvent({
  event = {},
  interpretation = {},
  activeGroups = [],
  nowMs = Date.now(),
  correlationWindowMs = 120000,
  fastCompletionWindowMs = 30 * 60 * 1000,
} = {}) {
  const scoped = scopedGroups(activeGroups, event);
  if (isDuplicateSourceEvent(scoped, event)) {
    return { status: 'NO_ACTION', reason: 'DUPLICATE_SOURCE_EVENT' };
  }

  const recent = activeRecentGroups(scoped, {}, Number(nowMs), Number(correlationWindowMs));
  const replyId = event?.thread?.reply_to_event_id != null ? String(event.thread.reply_to_event_id) : null;
  const threadId = event?.thread?.thread_id != null ? String(event.thread.thread_id) : null;

  if (interpretation.status === 'MANAGEMENT') {
    if (replyId) {
      const replyMatches = scoped.filter((group) => (group.sourceEventIds || []).map(String).includes(replyId));
      const target = matchedManagementTarget(replyMatches, 'REPLY_TARGET', 'AMBIGUOUS_REPLY_TARGET');
      if (target) return target;
      return { status: 'NEEDS_REVIEW', reason: 'NO_REPLY_TARGET' };
    }

    const brokerTarget = brokerIdentityTarget(scoped, interpretation);
    if (brokerTarget) return brokerTarget;

    if (threadId) {
      const threadMatches = scoped.filter((group) => group.threadId != null && String(group.threadId) === threadId);
      const target = matchedManagementTarget(threadMatches, 'THREAD_TARGET', 'AMBIGUOUS_THREAD_TARGET');
      if (target) return target;
      return { status: 'NEEDS_REVIEW', reason: 'NO_THREAD_TARGET' };
    }

    const symbol = managementSymbol(interpretation);
    if (symbol) {
      const symbolMatches = scoped.filter((group) => String(group.symbol ?? '').trim().toUpperCase() === symbol);
      const target = matchedManagementTarget(symbolMatches, 'SYMBOL_TARGET', 'AMBIGUOUS_MANAGEMENT_TARGET');
      if (target) return target;
      return { status: 'NEEDS_REVIEW', reason: 'NO_MANAGEMENT_TARGET' };
    }

    const continuityTarget = sourceMessageContinuityTarget(scoped, event);
    if (continuityTarget) return continuityTarget;

    const target = activeLogicalTradeTarget(scoped, {
      nowMs: Number(nowMs),
      windowMs: Number(correlationWindowMs),
    });
    if (target) return target;
    return { status: 'NEEDS_REVIEW', reason: 'NO_MANAGEMENT_TARGET' };
  }

  if (replyId) {
    const replyMatches = scoped.filter((group) => (group.sourceEventIds || []).map(String).includes(replyId));
    const target = matchedManagementTarget(replyMatches, 'REPLY_TARGET', 'AMBIGUOUS_REPLY_TARGET');
    if (target) return target;
    return { status: 'NEEDS_REVIEW', reason: 'NO_REPLY_TARGET' };
  }

  if (threadId) {
    const threadMatches = scoped.filter((group) => group.threadId != null && String(group.threadId) === threadId);
    const target = matchedManagementTarget(threadMatches, 'THREAD_TARGET', 'AMBIGUOUS_THREAD_TARGET');
    if (target) return target;
    return { status: 'NEEDS_REVIEW', reason: 'NO_THREAD_TARGET' };
  }

  if (interpretation.status === 'READY' && interpretation.intent) {
    const symbol = String(interpretation.intent.symbol?.canonical ?? '');
    const side = String(interpretation.intent.side ?? '');
    const fastEligible = fastCompletionEligibleGroups(scoped, Number(nowMs), Number(fastCompletionWindowMs));
    const fastCompletionMatches = fastEligible.filter((group) =>
      group.incomplete === true &&
      String(group.symbol ?? '') === symbol &&
      String(group.side ?? '') === side
    );

    if (!interpretation.intent.fastEntry && interpretation.intent.incomplete === false) {
      const fastCompletion = correlateFastCompletion(fastCompletionMatches);
      if (fastCompletion) return fastCompletion;
    }

    const duplicateFastEntry = recentFastDuplicateTarget(recent, interpretation.intent);
    if (duplicateFastEntry) return duplicateFastEntry;

    return { status: 'NEW_GROUP' };
  }

  return { status: 'NO_ACTION' };
}
