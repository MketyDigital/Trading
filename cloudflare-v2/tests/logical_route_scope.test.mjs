import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLogicalRouteScope, selectAuthorizedRoutesForFeed } from '../src/routes/logical_route_scope.js';

const route = (destinationId, sourceFeedId = null, extra = {}) => ({
  destination_id: destinationId,
  source_feed_id: sourceFeedId,
  priority: 100,
  ...extra,
});

test('default route authorizes all feeds when no selective rows exist for that destination', () => {
  const routes = [route('dest-mt5', null)];
  const resolved = resolveLogicalRouteScope({ routes, sourceFeedId: 'feed-a', destinationId: 'dest-mt5' });
  assert.equal(resolved.mode, 'all');
  assert.equal(resolved.routes.length, 1);
});

test('selective rows override legacy default for the same destination', () => {
  const routes = [
    route('dest-mt5', null, { id: 'legacy-default' }),
    route('dest-mt5', 'feed-a', { id: 'feed-a-route' }),
    route('dest-mt5', 'feed-b', { id: 'feed-b-route' }),
  ];

  const selected = resolveLogicalRouteScope({ routes, sourceFeedId: 'feed-a', destinationId: 'dest-mt5' });
  assert.equal(selected.mode, 'selective');
  assert.deepEqual(selected.routes.map((item) => item.id), ['feed-a-route']);

  const unselected = resolveLogicalRouteScope({ routes, sourceFeedId: 'feed-c', destinationId: 'dest-mt5' });
  assert.equal(unselected.mode, 'none');
  assert.deepEqual(unselected.routes, []);
});

test('selective authority is isolated per destination', () => {
  const routes = [
    route('dest-mt5', null, { id: 'mt5-default' }),
    route('dest-mt5', 'feed-a', { id: 'mt5-a' }),
    route('dest-telegram', null, { id: 'tg-default' }),
  ];

  const selected = selectAuthorizedRoutesForFeed(routes, 'feed-b');
  assert.deepEqual(selected.map((item) => item.id), ['tg-default']);
});

test('missing feed identity cannot inherit a default when destination is selective', () => {
  const routes = [
    route('dest-mt5', null, { id: 'legacy-default' }),
    route('dest-mt5', 'feed-a', { id: 'feed-a-route' }),
  ];
  assert.deepEqual(selectAuthorizedRoutesForFeed(routes, null), []);
});
