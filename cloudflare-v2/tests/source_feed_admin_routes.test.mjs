import assert from 'node:assert/strict';
import test from 'node:test';
import { handleAuthorizedV1AdminDestinationsRequest } from '../src/http/v1_admin_destinations.js';

function authorization() {
  return {
    workspace: { id: 'ws-1' },
    membership: { role: 'owner' },
  };
}

function request(body) {
  return new Request('https://trade.test/api/v1/admin/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('admin route API preserves source feed scope in public response', async () => {
  let received = null;
  const destinationStore = {
    async createRoute(workspaceId, input) {
      received = { workspaceId, input };
      return {
        id: 'route-1', workspace_id: workspaceId, source_connection_id: input.sourceConnectionId,
        source_feed_id: input.sourceFeedId, destination_id: input.destinationId, route_name: input.routeName,
        priority: input.priority, is_active: true, filters: input.filters,
      };
    },
  };

  const response = await handleAuthorizedV1AdminDestinationsRequest(request({
    sourceConnectionId: 'src-1',
    sourceFeedId: 'feed-1',
    destinationId: 'dest-1',
    routeName: 'Gold only',
    filters: { allowedCanonicalSymbols: ['xauusd', ' XAUUSD '] },
  }), authorization(), { destinationStore });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(received.input.sourceFeedId, 'feed-1');
  assert.deepEqual(received.input.filters.allowedCanonicalSymbols, ['XAUUSD']);
  assert.equal(payload.route.sourceFeedId, 'feed-1');
});

test('legacy/default connection route remains valid without a source feed', async () => {
  let received = null;
  const destinationStore = {
    async createRoute(_workspaceId, input) {
      received = input;
      return {
        id: 'route-legacy', workspace_id: 'ws-1', source_connection_id: input.sourceConnectionId,
        source_feed_id: null, destination_id: input.destinationId, priority: input.priority,
        is_active: true, filters: input.filters,
      };
    },
  };
  const response = await handleAuthorizedV1AdminDestinationsRequest(request({
    sourceConnectionId: 'src-1', destinationId: 'dest-1',
  }), authorization(), { destinationStore });
  assert.equal(response.status, 201);
  assert.equal(received.sourceFeedId, null);
});

test('malformed canonical symbol filter is rejected rather than broadened to empty filters', async () => {
  let calls = 0;
  const response = await handleAuthorizedV1AdminDestinationsRequest(request({
    sourceConnectionId: 'src-1', destinationId: 'dest-1',
    filters: { allowedCanonicalSymbols: 'XAUUSD' },
  }), authorization(), {
    destinationStore: { async createRoute() { calls += 1; } },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).reason, 'ROUTE_FILTERS_INVALID');
  assert.equal(calls, 0);
});
