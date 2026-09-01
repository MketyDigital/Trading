function activeRecentGroups(activeGroups, event, nowMs, windowMs) {
  const sourceInstanceId = String(event?.source?.instance_id ?? '');
  return (activeGroups || []).filter((group) => {
    if (!group || !['OPEN', 'PLANNED', 'PENDING'].includes(String(group.status || 'OPEN'))) return false;
    if (sourceInstanceId && String(group.sourceInstanceId ?? '') !== sourceInstanceId) return false;
    const updatedAt = Number(group.updatedAt ?? group.createdAt ?? 0);
    return updatedAt > 0 && nowMs - updatedAt <= windowMs;
  });
}

export function correlateTradingEvent({
  event = {},
  interpretation = {},
  activeGroups = [],
  nowMs = Date.now(),
  correlationWindowMs = 120000,
} = {}) {
  const recent = activeRecentGroups(activeGroups, event, Number(nowMs), Number(correlationWindowMs));
  const replyId = event?.thread?.reply_to_event_id != null ? String(event.thread.reply_to_event_id) : null;
  const threadId = event?.thread?.thread_id != null ? String(event.thread.thread_id) : null;

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

  if (interpretation.status === 'MANAGEMENT') {
    if (recent.length === 1) return { status: 'MATCHED', reason: 'ONLY_ACTIVE_GROUP', groupId: recent[0].id };
    if (recent.length > 1) return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_MANAGEMENT_TARGET' };
    return { status: 'NEEDS_REVIEW', reason: 'NO_MANAGEMENT_TARGET' };
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
      if (fastCompletionMatches.length === 1) {
        return { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: fastCompletionMatches[0].id };
      }
      if (fastCompletionMatches.length > 1) {
        return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS_FAST_ENTRY_COMPLETION' };
      }
    }

    return { status: 'NEW_GROUP' };
  }

  return { status: 'NO_ACTION' };
}
