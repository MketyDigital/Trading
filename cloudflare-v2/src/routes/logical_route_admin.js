function text(value) {
  return String(value ?? '').trim();
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeFilters(filters = {}) {
  const value = safeObject(filters);
  const allowed = Array.isArray(value.allowedCanonicalSymbols)
    ? [...new Set(value.allowedCanonicalSymbols.map((item) => text(item).toUpperCase()).filter(Boolean))]
    : [];
  const blocked = Array.isArray(value.blockedCanonicalSymbols)
    ? [...new Set(value.blockedCanonicalSymbols.map((item) => text(item).toUpperCase()).filter(Boolean))]
    : [];
  const out = { ...value };
  if (allowed.length) out.allowedCanonicalSymbols = allowed;
  else delete out.allowedCanonicalSymbols;
  if (blocked.length) out.blockedCanonicalSymbols = blocked;
  else delete out.blockedCanonicalSymbols;
  delete out.allowed_canonical_symbols;
  delete out.blocked_canonical_symbols;
  return out;
}

function stableJson(value) {
  const object = safeObject(value);
  return JSON.stringify(Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]])));
}

function rowSettings(row = {}) {
  return {
    routeName: row.route_name ?? row.routeName ?? null,
    priority: Number(row.priority ?? 100),
    filters: normalizeFilters(row.filters),
    enabled: (row.is_active ?? row.enabled) !== false,
  };
}

function settingsKey(settings = {}) {
  return [
    text(settings.routeName),
    String(Number(settings.priority ?? 100)),
    settings.enabled === false ? '0' : '1',
    stableJson(settings.filters),
  ].join('::');
}

function sourceIdOf(row = {}) {
  return text(row.source_connection_id ?? row.sourceConnectionId);
}

function destinationIdOf(row = {}) {
  return text(row.destination_id ?? row.destinationId);
}

function feedIdOf(row = {}) {
  return text(row.source_feed_id ?? row.sourceFeedId) || null;
}

function rowIdOf(row = {}) {
  return text(row.id);
}

export function groupLogicalRoutes(routes = []) {
  const pairs = new Map();
  for (const row of Array.isArray(routes) ? routes : []) {
    const sourceConnectionId = sourceIdOf(row);
    const destinationId = destinationIdOf(row);
    if (!sourceConnectionId || !destinationId) continue;
    const pairKey = `${sourceConnectionId}::${destinationId}`;
    if (!pairs.has(pairKey)) pairs.set(pairKey, { sourceConnectionId, destinationId, rows: [] });
    pairs.get(pairKey).rows.push(row);
  }

  const result = [];
  for (const pair of pairs.values()) {
    const activeSelectiveExists = pair.rows.some((row) => feedIdOf(row) && rowSettings(row).enabled);
    const compatibleGroups = new Map();

    for (const row of pair.rows) {
      const settings = rowSettings(row);
      const key = settingsKey(settings);
      if (!compatibleGroups.has(key)) compatibleGroups.set(key, { settings, rows: [] });
      compatibleGroups.get(key).rows.push(row);
    }

    for (const compatible of compatibleGroups.values()) {
      const selectiveRows = compatible.rows.filter((row) => feedIdOf(row));
      const defaultRows = compatible.rows.filter((row) => !feedIdOf(row));
      const settings = compatible.settings;
      const routeIds = compatible.rows.map(rowIdOf).filter(Boolean);
      const mode = selectiveRows.length ? 'selective' : 'all';
      const keySuffix = encodeURIComponent(settingsKey(settings));

      result.push({
        logicalRouteKey: `${pair.sourceConnectionId}::${pair.destinationId}::${keySuffix}`,
        sourceConnectionId: pair.sourceConnectionId,
        destinationId: pair.destinationId,
        mode,
        selectedFeedIds: [...new Set(selectiveRows.map(feedIdOf).filter(Boolean))],
        routeIds,
        routeName: settings.routeName,
        priority: settings.priority,
        filters: settings.filters,
        enabled: settings.enabled,
        mixedSettings: false,
        legacyDefaultSuppressed: selectiveRows.length > 0 && defaultRows.length > 0,
        suppressedBySelectiveRoutes: mode === 'all' && activeSelectiveExists,
      });
    }
  }

  return result;
}

export function inspectLogicalRouteEdit({
  pairRows = [],
  previousRouteIds = [],
  selectedFeedIds = [],
  mode = 'selective',
} = {}) {
  const rows = Array.isArray(pairRows) ? pairRows : [];
  const previousIds = [...new Set((Array.isArray(previousRouteIds) ? previousRouteIds : []).map(text).filter(Boolean))];
  const previous = new Set(previousIds);
  const foundPrevious = new Set();
  const editingRows = [];
  const siblingRows = [];

  for (const row of rows) {
    const id = rowIdOf(row);
    if (id && previous.has(id)) {
      editingRows.push(row);
      foundPrevious.add(id);
    } else {
      siblingRows.push(row);
    }
  }

  const desiredFeeds = new Set((Array.isArray(selectedFeedIds) ? selectedFeedIds : []).map(text).filter(Boolean));
  const overlappingFeedRouteIds = siblingRows
    .filter((row) => feedIdOf(row) && desiredFeeds.has(feedIdOf(row)))
    .map(rowIdOf)
    .filter(Boolean);
  const activeSiblingSelectiveRouteIds = siblingRows
    .filter((row) => feedIdOf(row) && rowSettings(row).enabled)
    .map(rowIdOf)
    .filter(Boolean);
  const siblingDefaultRouteIds = siblingRows
    .filter((row) => !feedIdOf(row))
    .map(rowIdOf)
    .filter(Boolean);

  return {
    editingRows,
    siblingRows,
    missingPreviousRouteIds: previousIds.filter((id) => !foundPrevious.has(id)),
    overlappingFeedRouteIds,
    activeSiblingSelectiveRouteIds,
    siblingDefaultRouteIds,
    mode: text(mode).toLowerCase(),
  };
}

function normalizedSettings(settings = {}) {
  const priority = Number(settings.priority ?? 100);
  if (!Number.isFinite(priority)) throw new Error('ROUTE_PRIORITY_INVALID');
  return {
    route_name: text(settings.routeName ?? settings.route_name) || null,
    priority,
    filters: normalizeFilters(settings.filters),
    is_active: settings.enabled !== false,
  };
}

export function planLogicalRouteReconcile({
  existingRows = [],
  sourceConnectionId = null,
  destinationId = null,
  mode,
  selectedFeedIds = [],
  settings = {},
} = {}) {
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const normalizedMode = text(mode).toLowerCase();
  if (!['all', 'selective'].includes(normalizedMode)) throw new Error('ROUTE_MODE_INVALID');
  const targetSourceId = text(sourceConnectionId);
  const targetDestinationId = text(destinationId);
  const authority = {};
  if (targetSourceId) authority.source_connection_id = targetSourceId;
  if (targetDestinationId) authority.destination_id = targetDestinationId;
  const common = { ...normalizedSettings(settings), ...authority };
  const desiredFeeds = [...new Set((Array.isArray(selectedFeedIds) ? selectedFeedIds : []).map(text).filter(Boolean))];
  if (normalizedMode === 'selective' && desiredFeeds.length === 0) throw new Error('ROUTE_FEEDS_REQUIRED');

  const updates = [];
  const inserts = [];
  const deleteIds = [];

  if (normalizedMode === 'all') {
    const keep = rows.find((row) => !feedIdOf(row)) || rows[0] || null;
    if (keep) {
      updates.push({ id: text(keep.id), patch: { ...common, source_feed_id: null } });
      for (const row of rows) if (text(row.id) !== text(keep.id)) deleteIds.push(text(row.id));
    } else {
      inserts.push({ ...common, source_feed_id: null });
    }
    return { updates, inserts, deleteIds };
  }

  const movingAuthority = rows.some((row) =>
    (targetSourceId && sourceIdOf(row) !== targetSourceId)
    || (targetDestinationId && destinationIdOf(row) !== targetDestinationId));

  const byFeed = new Map();
  const reusable = [];
  for (const row of rows) {
    const feedId = feedIdOf(row);
    if (!movingAuthority && feedId && !byFeed.has(feedId)) byFeed.set(feedId, row);
    else reusable.push(row);
  }

  const usedIds = new Set();
  for (const feedId of desiredFeeds) {
    const exact = byFeed.get(feedId);
    if (exact) {
      const id = text(exact.id);
      usedIds.add(id);
      updates.push({ id, patch: { ...common, source_feed_id: feedId } });
      continue;
    }
    const candidate = reusable.find((row) => !usedIds.has(text(row.id)));
    if (candidate) {
      const id = text(candidate.id);
      usedIds.add(id);
      updates.push({ id, patch: { ...common, source_feed_id: feedId } });
    } else {
      inserts.push({ ...common, source_feed_id: feedId });
    }
  }

  for (const row of rows) {
    const id = text(row.id);
    if (id && !usedIds.has(id) && !updates.some((item) => item.id === id)) deleteIds.push(id);
  }
  return { updates, inserts, deleteIds };
}