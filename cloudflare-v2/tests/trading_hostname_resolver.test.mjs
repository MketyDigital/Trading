import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTradingHostnameStore,
  resolveTradingRequestHostname,
} from '../src/security/trading_hostname_resolver.js';

function singleRowQuery(row, { error = null } = {}) {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_hostnames');
      const filters = [];
      const chain = {
        select() { return chain; },
        update() { return chain; },
        eq(column, value) { filters.push([column, value]); return chain; },
        maybeSingle: async () => ({ data: row, error }),
      };
      chain.filters = filters;
      return chain;
    },
  };
}

test('custom hostname lookup normalizes case and trailing dot and returns only active mapping', async () => {
  const supabase = singleRowQuery({
    hostname: 'trade.customer.example',
    workspace_id: 'ws-1',
    status: 'active',
    verified_at: '2026-09-05T00:00:00Z',
  });
  const store = createTradingHostnameStore(supabase);
  const resolved = await store.getActiveHostname('TRADE.Customer.Example.');

  assert.deepEqual(resolved, {
    hostname: 'trade.customer.example',
    workspaceId: 'ws-1',
    status: 'active',
    verifiedAt: '2026-09-05T00:00:00Z',
  });
});

test('canonical Mkety hostname is shared and does not preselect an enterprise workspace', async () => {
  let lookedUp = false;
  const store = {
    async getActiveHostname() {
      lookedUp = true;
      return null;
    },
  };

  const result = await resolveTradingRequestHostname(
    new Request('https://trade.mkety.com/api/v1/admin/workspace'),
    { hostnameStore: store },
  );

  assert.deepEqual(result, { ok: true, kind: 'canonical', hostname: 'trade.mkety.com', workspaceId: null });
  assert.equal(lookedUp, false);
});

test('pending customer hostname auto-activates when the request already reaches the Mkety Worker', async () => {
  const seen = [];
  const store = {
    async getActiveHostname(hostname) {
      seen.push(['active', hostname]);
      return null;
    },
    async getHostname(hostname) {
      seen.push(['any', hostname]);
      return { hostname, workspaceId: 'ws-1', status: 'pending', verifiedAt: null };
    },
    async activateHostname(hostname) {
      seen.push(['activate', hostname]);
      return { hostname, workspaceId: 'ws-1', status: 'active', verifiedAt: '2026-09-09T12:00:00Z' };
    },
  };

  const result = await resolveTradingRequestHostname(
    new Request('https://copier.starpipsforex.com/api/v1/admin/workspace'),
    { hostnameStore: store },
  );

  assert.deepEqual(result, {
    ok: true,
    kind: 'custom',
    hostname: 'copier.starpipsforex.com',
    workspaceId: 'ws-1',
    autoActivated: true,
  });
  assert.deepEqual(seen, [
    ['active', 'copier.starpipsforex.com'],
    ['any', 'copier.starpipsforex.com'],
    ['activate', 'copier.starpipsforex.com'],
  ]);
});

test('unknown and disabled customer hostnames still fail closed', async () => {
  for (const row of [null, { hostname: 'customer.example', workspaceId: 'ws-1', status: 'disabled' }]) {
    const store = {
      async getActiveHostname() { return null; },
      async getHostname() { return row; },
      async activateHostname() { throw new Error('must not activate'); },
    };
    const result = await resolveTradingRequestHostname(
      new Request('https://customer.example/api/v1/admin/workspace'),
      { hostnameStore: store },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'TRADING_HOSTNAME_NOT_ACTIVE');
  }
});

test('resolver uses request URL hostname and ignores forwarded-host headers', async () => {
  const seen = [];
  const store = {
    async getActiveHostname(hostname) {
      seen.push(hostname);
      return { hostname, workspaceId: 'ws-1', status: 'active', verifiedAt: null };
    },
  };
  const request = new Request('https://trade.customer.example/api/v1/admin/workspace', {
    headers: { 'X-Forwarded-Host': 'attacker.example', 'Forwarded': 'host=attacker.example' },
  });
  const result = await resolveTradingRequestHostname(request, { hostnameStore: store });

  assert.equal(result.ok, true);
  assert.equal(result.workspaceId, 'ws-1');
  assert.deepEqual(seen, ['trade.customer.example']);
});
