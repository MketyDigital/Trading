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

function activeLogicalTradeTarget(groups = []) {
  if (groups.length === 0) return null;
  if (groups.length === 1) {
    return { status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: groups[0].id };
  }
  if (sameLogicalTrade(groups)) {
    return { status: 'MATCHED', reason: 'ONLY_ACTIVE_TRADE', groupIds: groups.map((group) => group.id) };
  }
  return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' };
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

    const target = activeLogicalTradeTarget(scoped);
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

    return { status: 'NEW_GROUP' };
  }

  return { status: 'NO_ACTION' };
}
