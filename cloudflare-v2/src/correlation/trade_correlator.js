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

function telegramMessageIdentity(value) {
  const match = /^telegram:([^:]+):(\d+)$/.exec(String(value || '').trim());
  if (!match) return null;
  const messageId = Number(match[2]);
  if (!Number.isSafeInteger(messageId) || messageId < 1) return null;
  return { chatId: match[1], messageId };
}

function latestTelegramMessageId(cohort = [], chatId, beforeMessageId) {
  let latest = null;
  for (const group of cohort) {
    for (const sourceEventId of group?.sourceEventIds || []) {
      const identity = telegramMessageIdentity(sourceEventId);
      if (!identity || identity.chatId !== chatId || identity.messageId >= beforeMessageId) continue;
      if (latest == null || identity.messageId > latest) latest = identity.messageId;
    }
  }
  return latest;
}

function sourceMessageContinuityTarget(groups = [], event = {}, { maxMessageGap = 8 } = {}) {
  const current = telegramMessageIdentity(event?.external_event_id);
  if (!current) return null;

  const candidates = logicalCohorts(groups)
    .map((cohort) => {
      const latestMessageId = latestTelegramMessageId(cohort, current.chatId, current.messageId);
      return latestMessageId == null ? null : {
        cohort,
        latestMessageId,
        gap: current.messageId - latestMessageId,
      };
    })
    .filter((entry) => entry && entry.gap > 0 && entry.gap <= Number(maxMessageGap))
    .sort((a, b) => a.gap - b.gap || b.latestMessageId - a.latestMessageId);

  if (candidates.length === 0) return null;
  const nearestGap = candidates[0].gap;
  const nearest = candidates.filter((entry) => entry.gap === nearestGap);
  if (nearest.length !== 1) return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' };
  return targetForCohort(nearest[0].cohort, 'SOURCE_MESSAGE_CONTINUITY');
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
    }

    if (threadId) {
      const threadMatches = scoped.filter((group) => group.threadId != null && String(group.threadId) === threadId);
      const target = matchedManagementTarget(threadMatches, 'THREAD_TARGET', 'AMBIGUOUS_THREAD_TARGET');
      if (target) return target;
    }

    const symbol = managementSymbol(interpretation);
    if (symbol) {
      const symbolMatches = scoped.filter((group) => String(group.symbol ?? '').trim().toUpperCase() === symbol);
      const target = matchedManagementTarget(symbolMatches, 'SYMBOL_TARGET', 'AMBIGUOUS_MANAGEMENT_TARGET');
      if (target) return target;
      return { status: 'NEEDS_REVIEW', reason: 'NO_MANAGEMENT_TARGET' };
    }

    const sourceContinuity = sourceMessageContinuityTarget(scoped, event);
    if (sourceContinuity) return sourceContinuity;

    const target = activeLogicalTradeTarget(scoped, {
      nowMs: Number(nowMs),
      windowMs: Number(correlationWindowMs),
    });
    if (target) return target;
    return { status: 'NEEDS_REVIEW', reason: 'NO_MANAGEMENT_TARGET' };
  }

  if (replyId) {
    const replyMatches = recent.filter((group) => (group.sourceEventIds || []).map(String).includes(replyId));
    if (replyMatches.length === 1) return { status: 'MATCHED', reason: 'REPLY_TARGET', groupId: replyMatches[0].id };
    if (replyMatches.length > 1) return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_REPLY_TARGET' };
  }

  if (threadId) {
    const threadMatches = recent.filter((group) => group.threadId != null && String(group.threadId) === threadId);
    if (threadMatches.length === 1) return { status: 'MATCHED', reason: 'THREAD_TARGET', groupId: threadMatches[0].id };
    if (threadMatches.length > 1) return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_THREAD_TARGET' };
  }

  if (interpretation.status === 'READY' && interpretation.intent) {
    const symbol = String(interpretation.intent.symbol?.canonical ?? '');
    const side = String(interpretation.intent.side ?? '');
    const fastCompletionMatches = recent.filter((group) =>
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