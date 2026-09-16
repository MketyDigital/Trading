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

function sameSettings(a, b) {
  return a.routeName === b.routeName
    && a.priority === b.priority
    && a.enabled === b.enabled
    && stableJson(a.filters) === stableJson(b.filters);
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

export function groupLogicalRoutes(routes = []) {
  const grouped = new Map();
  for (const row of Array.isArray(routes) ? routes : []) {
    const sourceConnectionId = sourceIdOf(row);
    const destinationId = destinationIdOf(row);
    if (!sourceConnectionId || !destinationId) continue;
    const key = `${sourceConnectionId}::${destinationId}`;
    if (!grouped.has(key)) grouped.set(key, { sourceConnectionId, destinationId, rows: [] });
    grouped.get(key).rows.push(row);
  }

  return [...grouped.values()].map((group) => {
    const selectiveRows = group.rows.filter((row) => feedIdOf(row));
    const defaultRows = group.rows.filter((row) => !feedIdOf(row));
    const authoritativeRows = selectiveRows.length ? selectiveRows : defaultRows;
    const representative = authoritativeRows[0] || group.rows[0] || {};
    const settings = rowSettings(representative);
    const mixedSettings = authoritativeRows.some((row) => !sameSettings(settings, rowSettings(row)));
    return {
      logicalRouteKey: `${group.sourceConnectionId}::${group.destinationId}`,
      sourceConnectionId: group.sourceConnectionId,
      destinationId: group.destinationId,
      mode: selectiveRows.length ? 'selective' : 'all',
      selectedFeedIds: [...new Set(selectiveRows.map(feedIdOf).filter(Boolean))],
      routeIds: group.rows.map((row) => text(row.id)).filter(Boolean),
      routeName: mixedSettings ? null : settings.routeName,
      priority: mixedSettings ? null : settings.priority,
      filters: mixedSettings ? {} : settings.filters,
      enabled: mixedSettings ? null : settings.enabled,
      mixedSettings,
      legacyDefaultSuppressed: selectiveRows.length > 0 && defaultRows.length > 0,
    };
  });
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
