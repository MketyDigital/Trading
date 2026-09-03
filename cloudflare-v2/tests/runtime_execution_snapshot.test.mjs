import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeExecutionSnapshotCache } from '../src/execution/runtime_execution_snapshot.js';

function record(overrides = {}) {
  return {
    workspaceId: 'ws-1',
    sourceId: 'src-1',
    accountId: 'acct-1',
    version: 'v1',
    sourceEnabled: true,
    accountActive: true,
    executionEnabled: true,
    safetyPolicy: { enabled: true, killSwitch: false },
    fastEntryPolicy: 'execute_immediately',
    entryZonePolicy: 'nearest',
    symbolCatalogVersion: 'sym-v1',
    brokerMetadataVersion: 'broker-v1',
    ...overrides,
  };
}

test('stores and retrieves bounded non-secret execution configuration by exact workspace/source/account key', () => {
  let now = 100;
  const cache = createRuntimeExecutionSnapshotCache({ maxEntries: 4, ttlMs: 1000, clock: () => now });
  cache.put(record());
  assert.deepEqual(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' }), record());
  assert.equal(cache.get({ workspaceId: 'ws-2', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' }), null);
});

test('never retains credentials, tokens, broker logins, secrets, or encrypted fields', () => {
  const cache = createRuntimeExecutionSnapshotCache();
  cache.put(record({
    access_token: 'token-x',
    encrypted_credentials: 'cipher-x',
    password: 'secret-x',
    brokerLogin: '123456',
    apiKey: 'key-x',
    nested: { refreshToken: 'refresh-x', safe: 'ok' },
  }));
  const snapshot = cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' });
  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /token-x|cipher-x|secret-x|123456|key-x|refresh-x/);
  assert.equal(snapshot.nested?.safe, 'ok');
});

test('version mismatch and TTL expiry force cache miss', () => {
  let now = 0;
  const cache = createRuntimeExecutionSnapshotCache({ ttlMs: 10, clock: () => now });
  cache.put(record());
  assert.equal(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v2' }), null);
  now = 11;
  assert.equal(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' }), null);
});

test('invalidation is exact and workspace invalidation cannot affect siblings', () => {
  const cache = createRuntimeExecutionSnapshotCache({ maxEntries: 10 });
  cache.put(record());
  cache.put(record({ workspaceId: 'ws-1', accountId: 'acct-2' }));
  cache.put(record({ workspaceId: 'ws-2', sourceId: 'src-2', accountId: 'acct-3' }));

  cache.invalidate({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1' });
  assert.equal(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' }), null);
  assert.ok(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-2', version: 'v1' }));

  cache.invalidateWorkspace('ws-1');
  assert.equal(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-2', version: 'v1' }), null);
  assert.ok(cache.get({ workspaceId: 'ws-2', sourceId: 'src-2', accountId: 'acct-3', version: 'v1' }));
});

test('max-entry bound evicts the oldest snapshot instead of growing without limit', () => {
  let now = 0;
  const cache = createRuntimeExecutionSnapshotCache({ maxEntries: 2, ttlMs: 10000, clock: () => now++ });
  cache.put(record({ accountId: 'acct-1' }));
  cache.put(record({ accountId: 'acct-2' }));
  cache.put(record({ accountId: 'acct-3' }));
  assert.equal(cache.size(), 2);
  assert.equal(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' }), null);
  assert.ok(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-2', version: 'v1' }));
  assert.ok(cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-3', version: 'v1' }));
});

test('callers cannot mutate cached authority through returned object references', () => {
  const cache = createRuntimeExecutionSnapshotCache();
  cache.put(record());
  const first = cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' });
  first.executionEnabled = false;
  first.safetyPolicy.killSwitch = true;
  const second = cache.get({ workspaceId: 'ws-1', sourceId: 'src-1', accountId: 'acct-1', version: 'v1' });
  assert.equal(second.executionEnabled, true);
  assert.equal(second.safetyPolicy.killSwitch, false);
});
