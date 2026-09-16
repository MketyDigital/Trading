function text(value) {
  return String(value ?? '').trim();
}

function routeDestinationId(route = {}) {
  return text(route.destination_id ?? route.destinationId);
}

function routeFeedId(route = {}) {
  return text(route.source_feed_id ?? route.sourceFeedId) || null;
}

function byPriority(a = {}, b = {}) {
  return Number(a.priority ?? 100) - Number(b.priority ?? 100);
}

export function resolveLogicalRouteScope({ routes = [], sourceFeedId = null, destinationId = null } = {}) {
  const destination = text(destinationId);
  const feed = text(sourceFeedId) || null;
  const rows = (Array.isArray(routes) ? routes : [])
    .filter((route) => !destination || routeDestinationId(route) === destination)
    .sort(byPriority);

  const selective = rows.filter((route) => routeFeedId(route));
  if (selective.length) {
    const selected = feed ? selective.filter((route) => routeFeedId(route) === feed) : [];
    return { mode: selected.length ? 'selective' : 'none', routes: selected };
  }

  const defaults = rows.filter((route) => !routeFeedId(route));
  if (defaults.length) return { mode: 'all', routes: defaults };
  return { mode: 'none', routes: [] };
}

export function selectAuthorizedRoutesForFeed(routes = [], sourceFeedId = null) {
  const rows = Array.isArray(routes) ? routes : [];
  const destinationIds = [];
  const seen = new Set();
  for (const row of rows) {
    const destinationId = routeDestinationId(row);
    if (!destinationId || seen.has(destinationId)) continue;
    seen.add(destinationId);
    destinationIds.push(destinationId);
  }

  const selected = [];
  for (const destinationId of destinationIds) {
    selected.push(...resolveLogicalRouteScope({ routes: rows, sourceFeedId, destinationId }).routes);
  }
  return selected.sort(byPriority);
}
