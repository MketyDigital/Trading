import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1SimulationDependencies } from '../src/pipeline/v1_simulation_deps.js';

test('portal follower expansion uses one parent-link lookup and does not create source route rows', async () => {
  let linkLookups = 0;
  const runtime = {
    routes: { list: async () => [{ source_connection_id: 'src', destination_id: 'dst', is_active: true, filters: {} }] },
    sourceFeeds: { findActiveFeed: async () => null },
    destinations: { listDestinations: async () => [{ id: 'dst', destination_type: 'broker_account', destination_ref: 'parent', is_active: true }] },
    accountFollowers: { listEnabledByParents: async (_workspaceId, parents) => { linkLookups += 1; assert.deepEqual(parents, ['parent']); return [{ follower_account_id: 'follower', parent_account_id: 'parent', enabled: true, lot_multiplier: 0.5 }]; }, listEnabledByFollowers: async () => [] },
    accounts: { listAccounts: async () => [
      { id: 'parent', workspace_id: 'ws', is_active: true, execution_enabled: true, platform: 'mt5', lot_sizing_type: 'fixed', lot_value: 0.1, provider_config: { symbolCatalog: [{ platformSymbol: 'XAUUSD' }] } },
      { id: 'follower', workspace_id: 'ws', is_active: true, execution_enabled: true, platform: 'mt5', lot_sizing_type: 'fixed', lot_value: 0.1, provider_config: { symbolCatalog: [{ platformSymbol: 'XAUUSD' }] } },
    ] },
  };
  const deps = await createV1SimulationDependencies({
    env: { TRADE_STATE_INTERNAL_TOKEN: 'token', TRADE_STATE_NAMESPACE: { idFromName: (id) => id, get: () => ({ fetch: async () => new Response('{}', { status: 404 }) }) } },
    persistenceRuntime: runtime,
    event: { workspace_hint: 'ws' },
    sourceId: 'src',
  });
  const accounts = await deps.accountProvider('ws', { source: { provider_feed_id: null } }, { status: 'READY', intent: { symbol: { canonical: 'XAUUSD' } } });
  assert.deepEqual(accounts.map((row) => row.id), ['parent', 'follower']);
  assert.equal(linkLookups, 1);
});
