import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminHostnamesRequest } from '../src/http/v1_admin_hostnames.js';

const ENV = {
  CLOUDFLARE_API_TOKEN: 'provider-secret-token',
  CLOUDFLARE_ZONE_ID: 'zone-1',
  TRADING_CUSTOM_HOSTNAME_CNAME_TARGET: 'customers.mkety.com',
  TRADING_CANONICAL_HOSTS: 'trade.mkety.com',
};

const AUTH = {
  workspace: { id: 'ws-1' },
  membership: { role: 'owner' },
};

function provider(overrides = {}) {
  return {
    providerId: 'cf-host-1',
    hostname: 'trading.customer.com',
    hostnameStatus: 'pending',
    sslStatus: 'pending_validation',
    verificationErrors: [],
    validation: {
      ownership: { name: '_cf-custom-hostname.trading.customer.com', type: 'txt', value: 'ownership-token' },
      ownershipHttp: null,
      sslRecords: [{ txtName: '_acme-challenge.trading.customer.com', txtValue: 'ssl-token' }],
    },
    ...overrides,
  };
}

test('create validates hostname, provisions Cloudflare, persists exact workspace pending, and returns only safe instructions', async () => {
  const calls = [];
  const hostnameStore = {
    async create(workspaceId, hostname) {
      calls.push(['create', workspaceId, hostname]);
      return { id: 'h-1', workspace_id: workspaceId, hostname, status: 'pending', verified_at: null };
    },
  };
  const providerClientFactory = (env) => {
    assert.equal(env.CLOUDFLARE_API_TOKEN, 'provider-secret-token');
    return { async create(hostname) { calls.push(['provider-create', hostname]); return provider({ hostname, hostnameStatus: 'active', sslStatus: 'active' }); } };
  };

  const response = await handleAuthorizedV1AdminHostnamesRequest(new Request('https://trade.mkety.com/api/v1/admin/hostnames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname: 'Trading.Customer.com' }),
  }), AUTH, { hostnameStore, env: ENV, providerClientFactory });
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    ['provider-create', 'trading.customer.com'],
    ['create', 'ws-1', 'trading.customer.com'],
  ]);
  assert.equal(body.hostname.status, 'pending');
  assert.equal(body.hostname.cname.target, 'customers.mkety.com');
  assert.equal(body.hostname.validation.ownership.value, 'ownership-token');
  assert.equal(JSON.stringify(body).includes('provider-secret-token'), false);
});

test('create rejects malformed, wildcard, canonical and CNAME-target hostnames before provider call', async () => {
  let providerCalls = 0;
  const providerClientFactory = () => ({ async create() { providerCalls += 1; return provider(); } });
  const hostnameStore = { async create() { throw new Error('must not persist invalid hostname'); } };
  for (const hostname of ['https://evil.example', '*.example.com', 'trade.mkety.com', 'customers.mkety.com', '127.0.0.1', 'bad host.example']) {
    const response = await handleAuthorizedV1AdminHostnamesRequest(new Request('https://trade.mkety.com/api/v1/admin/hostnames', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname }),
    }), AUTH, { hostnameStore, env: ENV, providerClientFactory });
    assert.equal(response.status, 400, hostname);
  }
  assert.equal(providerCalls, 0);
});

test('verify resolves persisted hostname by exact workspace and activates only when hostname and SSL are both active', async () => {
  const seen = [];
  const hostnameStore = {
    async get(workspaceId, id) {
      seen.push(['get', workspaceId, id]);
      return { id, workspace_id: workspaceId, hostname: 'trading.customer.com', status: 'pending', verified_at: null };
    },
    async syncVerification(workspaceId, id, active) {
      seen.push(['sync', workspaceId, id, active]);
      return { id, workspace_id: workspaceId, hostname: 'trading.customer.com', status: active ? 'active' : 'pending', verified_at: active ? '2026-09-05T22:00:00Z' : null };
    },
  };
  const providerClientFactory = () => ({
    async getByHostname(hostname) {
      seen.push(['provider-get', hostname]);
      return provider({ hostnameStatus: 'active', sslStatus: 'active' });
    },
  });

  const response = await handleAuthorizedV1AdminHostnamesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/hostnames/h-1/verify', { method: 'POST' }),
    AUTH,
    { hostnameStore, env: ENV, providerClientFactory },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.hostname.status, 'active');
  assert.deepEqual(seen, [
    ['get', 'ws-1', 'h-1'],
    ['provider-get', 'trading.customer.com'],
    ['sync', 'ws-1', 'h-1', true],
  ]);
});

test('verify remains pending when either Cloudflare hostname or SSL is not active', async () => {
  let synced = null;
  const hostnameStore = {
    async get(workspaceId, id) { return { id, workspace_id: workspaceId, hostname: 'trading.customer.com', status: 'pending' }; },
    async syncVerification(workspaceId, id, active) {
      synced = active;
      return { id, workspace_id: workspaceId, hostname: 'trading.customer.com', status: active ? 'active' : 'pending', verified_at: null };
    },
  };
  const providerClientFactory = () => ({ async getByHostname() { return provider({ hostnameStatus: 'active', sslStatus: 'pending_validation' }); } });
  const response = await handleAuthorizedV1AdminHostnamesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/hostnames/h-1/verify', { method: 'POST' }), AUTH,
    { hostnameStore, env: ENV, providerClientFactory },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).verified, false);
  assert.equal(synced, false);
});

test('failed local create performs best-effort cleanup of the newly provisioned Cloudflare hostname', async () => {
  const deleted = [];
  const hostnameStore = { async create() { throw new Error('duplicate'); } };
  const providerClientFactory = () => ({
    async create() { return provider(); },
    async delete(id) { deleted.push(id); },
  });
  const response = await handleAuthorizedV1AdminHostnamesRequest(new Request('https://trade.mkety.com/api/v1/admin/hostnames', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname: 'trading.customer.com' }),
  }), AUTH, { hostnameStore, env: ENV, providerClientFactory });
  assert.equal(response.status, 409);
  assert.deepEqual(deleted, ['cf-host-1']);
});

test('missing Cloudflare configuration fails closed before store or provider mutation', async () => {
  let calls = 0;
  const response = await handleAuthorizedV1AdminHostnamesRequest(new Request('https://trade.mkety.com/api/v1/admin/hostnames', { method: 'GET' }), AUTH, {
    hostnameStore: { async list() { calls += 1; return []; } },
    env: {},
    providerClientFactory: () => { calls += 1; return {}; },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'CUSTOM_HOSTNAME_PROVIDER_NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('operator cannot provision customer hostname', async () => {
  let providerCalls = 0;
  const response = await handleAuthorizedV1AdminHostnamesRequest(new Request('https://trade.mkety.com/api/v1/admin/hostnames', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hostname: 'trading.customer.com' }),
  }), { workspace: { id: 'ws-1' }, membership: { role: 'operator' } }, {
    hostnameStore: {},
    env: ENV,
    providerClientFactory: () => ({ async create() { providerCalls += 1; } }),
  });
  assert.equal(response.status, 403);
  assert.equal(providerCalls, 0);
});
