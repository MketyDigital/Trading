import { buildCanonicalSourceEventId } from '../sources/canonical_event_id.js';

const AVAILABLE_HEALTH = new Set(['HEALTHY']);

function normalizedId(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function baseSelectionResult(workspaceId, sourceFamily) {
  return {
    ok: false,
    reason: 'NO_ENABLED_PROVIDER',
    workspaceId,
    sourceFamily,
    preferredSourceId: null,
    selectedSourceId: null,
    usingFallback: false,
    enabledSourceIds: [],
    availableSourceIds: [],
    unavailableSourceIds: [],
  };
}

function sourcePriority(source) {
  const priority = Number(source?.priority ?? 0);
  return Number.isFinite(priority) ? priority : Number.MAX_SAFE_INTEGER;
}

function sortSources(a, b) {
  if (Boolean(a?.isDefault) !== Boolean(b?.isDefault)) return a?.isDefault ? -1 : 1;
  return sourcePriority(a) - sourcePriority(b);
}

export function evaluateProviderFamilyAcceptance({ workspaceId, sourceFamily, sources = [] } = {}) {
  const trustedWorkspaceId = normalizedId(workspaceId);
  const trustedFamily = normalizedId(sourceFamily);
  const result = baseSelectionResult(trustedWorkspaceId, trustedFamily);

  if (!trustedWorkspaceId || !trustedFamily || !Array.isArray(sources)) return result;

  const enabled = sources
    .filter((source) => (
      normalizedId(source?.workspaceId ?? source?.workspace_id) === trustedWorkspaceId
      && normalizedId(source?.sourceFamily ?? source?.source_family) === trustedFamily
      && Boolean(source?.enabled ?? source?.is_active)
    ))
    .slice()
    .sort(sortSources);

  result.enabledSourceIds = enabled.map((source) => String(source.id));
  if (enabled.length === 0) return result;

  const preferred = enabled.find((source) => Boolean(source?.isDefault ?? source?.is_default)) || enabled[0];
  const available = enabled.filter((source) => AVAILABLE_HEALTH.has(String(source?.health?.status ?? source?.health_status ?? '').toUpperCase()));
  const unavailable = enabled.filter((source) => !available.includes(source));

  result.preferredSourceId = String(preferred.id);
  result.availableSourceIds = available.map((source) => String(source.id));
  result.unavailableSourceIds = unavailable.map((source) => String(source.id));

  if (available.length === 0) {
    return { ...result, reason: 'NO_AVAILABLE_PROVIDER' };
  }

  const selected = available.includes(preferred) ? preferred : available[0];
  return {
    ...result,
    ok: true,
    reason: null,
    selectedSourceId: String(selected.id),
    usingFallback: String(selected.id) !== String(preferred.id),
  };
}

function replayFailure(reason, sourceId = null) {
  return { ok: false, reason, sourceId: sourceId == null ? null : String(sourceId) };
}

export function evaluateCrossProviderReplay({ workspaceId, arrivals = [] } = {}) {
  const trustedWorkspaceId = normalizedId(workspaceId);
  if (!trustedWorkspaceId || !Array.isArray(arrivals)) return replayFailure('REPLAY_INPUT_INVALID');

  const canonicalEventIds = [];
  const workspaceScopedEventKeys = [];
  const providerSourceIds = [];
  const seen = new Set();
  let duplicateArrivalCount = 0;

  for (const arrival of arrivals) {
    const source = arrival?.source;
    const sourceId = normalizedId(source?.id);
    if (!sourceId) return replayFailure('SOURCE_ID_REQUIRED');

    const sourceWorkspaceId = normalizedId(source?.workspaceId ?? source?.workspace_id);
    if (sourceWorkspaceId !== trustedWorkspaceId) return replayFailure('SOURCE_WORKSPACE_MISMATCH', sourceId);
    if (!Boolean(source?.enabled ?? source?.is_active)) return replayFailure('SOURCE_NOT_ENABLED', sourceId);

    const sourceFamily = normalizedId(source?.sourceFamily ?? source?.source_family);
    const accountScope = normalizedId(source?.externalIdentity ?? source?.external_identity);
    if (!sourceFamily || !accountScope) return replayFailure('SOURCE_CANONICAL_SCOPE_MISSING', sourceId);

    let canonicalEventId;
    try {
      canonicalEventId = buildCanonicalSourceEventId({
        sourceFamily,
        accountScope,
        nativeIdentity: arrival?.nativeIdentity ?? arrival?.native_identity,
      });
    } catch {
      return replayFailure('NATIVE_EVENT_IDENTITY_INVALID', sourceId);
    }

    const workspaceScopedKey = `${trustedWorkspaceId}:${canonicalEventId}`;
    if (seen.has(workspaceScopedKey)) duplicateArrivalCount += 1;
    else seen.add(workspaceScopedKey);

    canonicalEventIds.push(canonicalEventId);
    workspaceScopedEventKeys.push(workspaceScopedKey);
    providerSourceIds.push(sourceId);
  }

  return {
    ok: true,
    workspaceId: trustedWorkspaceId,
    uniqueEventCount: seen.size,
    duplicateArrivalCount,
    canonicalEventIds: [...new Set(canonicalEventIds)],
    workspaceScopedEventKeys: [...new Set(workspaceScopedEventKeys)],
    providerSourceIds,
  };
}
