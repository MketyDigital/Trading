import test from 'node:test';
import assert from 'node:assert/strict';

import { groupLogicalRoutes, planLogicalRouteReconcile } from '../src/routes/logical_route_admin.js';

const row = (id, feedId = null, extra = {}) => ({
  id,
  source_connection_id: 'source-main',
  destination_id: 'dest-mt5',
  source_feed_id: feedId,
  route_name: 'Main to MT5',
  priority: 100,
  filters: {},
  is_active: true,
  ...extra,
});

test('legacy default route is exposed as one all-channels logical route', () => {
  const groups = groupLogicalRoutes([row('route-default')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].mode, 'all');
  assert.deepEqual(groups[0].selectedFeedIds, []);
  assert.deepEqual(groups[0].routeIds, ['route-default']);
});

test('feed rows for same source and destination become one selective logical route', () => {
  const groups = groupLogicalRoutes([row('route-a', 'feed-a'), row('route-b', 'feed-b')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].mode, 'selective');
  assert.deepEqual(groups[0].selectedFeedIds, ['feed-a', 'feed-b']);
  assert.equal(groups[0].mixedSettings, false);
});

test('suppressed legacy default is visible but does not change selective mode', () => {
  const groups = groupLogicalRoutes([row('route-default'), row('route-a', 'feed-a')]);
  assert.equal(groups[0].mode, 'selective');
  assert.equal(groups[0].legacyDefaultSuppressed, true);
  assert.deepEqual(groups[0].selectedFeedIds, ['feed-a']);
});

test('converting all-channels to selective reuses existing route id', () => {
  const plan = planLogicalRouteReconcile({
    existingRows: [row('route-default')],
    mode: 'selective',
    selectedFeedIds: ['feed-a', 'feed-b'],
    settings: { routeName: 'Main to MT5', priority: 100, filters: {}, enabled: true },
  });
  assert.deepEqual(plan.updates.map((item) => [item.id, item.patch.source_feed_id]), [['route-default', 'feed-a']]);
  assert.deepEqual(plan.inserts.map((item) => item.source_feed_id), ['feed-b']);
  assert.deepEqual(plan.deleteIds, []);
});

test('selective edit preserves selected route ids and deletes only unchecked rows', () => {
  const plan = planLogicalRouteReconcile({
    existingRows: [row('route-a', 'feed-a'), row('route-b', 'feed-b'), row('route-c', 'feed-c')],
    mode: 'selective',
    selectedFeedIds: ['feed-a', 'feed-c'],
    settings: { routeName: 'Edited', priority: 5, filters: { allowedCanonicalSymbols: ['XAUUSD'] }, enabled: true },
  });
  assert.deepEqual(plan.updates.map((item) => item.id), ['route-a', 'route-c']);
  assert.deepEqual(plan.deleteIds, ['route-b']);
  assert.deepEqual(plan.inserts, []);
});

test('converting selective to all reuses one route id and removes siblings', () => {
  const plan = planLogicalRouteReconcile({
    existingRows: [row('route-a', 'feed-a'), row('route-b', 'feed-b')],
    mode: 'all',
    selectedFeedIds: [],
    settings: { routeName: 'All Main to MT5', priority: 50, filters: {}, enabled: true },
  });
  assert.deepEqual(plan.updates.map((item) => [item.id, item.patch.source_feed_id]), [['route-a', null]]);
  assert.deepEqual(plan.deleteIds, ['route-b']);
  assert.deepEqual(plan.inserts, []);
});
