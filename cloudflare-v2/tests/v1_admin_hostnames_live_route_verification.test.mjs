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

function hostnameStore(seen) {
  return {
    async get(workspaceId, id) {
      seen.push(['get', workspaceId, id]);
      return { id, workspace_id: workspaceId, hostname: 'copier.starpipsforex.com', status: 'pending', verified_at: null };
    },
    async syncVerification(workspaceId, id, active) {
      seen.push(['sync', workspaceId, id, active]);
      return {
        id,
        workspace_id: workspaceId,
        hostname: 'copier.starpipsforex.com',
        status: active ? 'active' : 'pending',
        verified_at: active ? '2026-09-09T12:00:00Z' : null,
      };
    },
  };
}

function provider(overrides = {}) {
  return {
    providerId: 'cf-host-1',
    hostname: 'copier.starpipsforex.com',
    hostnameStatus: 'active',
    sslStatus: 'pending_validation',
    workerRouteConfigured: true,
    verificationErrors: [],
    validation: { ownership: null, ownershipHttp: null, sslRecords: [] },
    ...overrides,
  };
}

async function verify({ providerState, routeProof }) {
  const seen = [];
  const response = await handleAuthorizedV1AdminHostnamesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/hostnames/h-1/verify', { method: 'POST' }),
    AUTH,
    {
      hostnameStore: hostnameStore(seen),
      env: ENV,
      providerClientFactory: () => ({ async getByHostname() { return provider(providerState); } }),
      routeProbeFn: async (hostname, expectedWorkspaceId) => {
        seen.push(['probe', hostname, expectedWorkspaceId]);
        return routeProof;
      },
    },
  );
  return { response, body: await response.json(), seen };
}

test('activates cross-account custom hostname when SSL is pending but live Mkety route proof succeeds', async () => {
  const { response, body, seen } = await verify({
    providerState: { hostnameStatus: 'active', sslStatus: 'pending_validation', workerRouteConfigured: true },
    routeProof: { ok: true, hostname: 'copier.starpipsforex.com', workspaceId: 'ws-1' },
  });

  assert.equal(response.status, 200);
  assert.equal(body.verified, true);
  assert.equal(body.hostname.status, 'active');
  assert.deepEqual(seen, [
    ['get', 'ws-1', 'h-1'],
    ['probe', 'copier.starpipsforex.com', 'ws-1'],
    ['sync', 'ws-1', 'h-1', true],
  ]);
});

test('treats expired provider SSL as recoverable when the live Mkety route proves the workspace', async () => {
  const { body, seen } = await verify({
    providerState: { hostnameStatus: 'expired', sslStatus: 'expired', workerRouteConfigured: true },
    routeProof: { ok: true, hostname: 'copier.starpipsforex.com', workspaceId: 'ws-1' },
  });

  assert.equal(body.verified, true);
  assert.deepEqual(seen.at(-1), ['sync', 'ws-1', 'h-1', true]);
});

test('does not activate when live hostname reaches the wrong workspace', async () => {
  const { body, seen } = await verify({
    providerState: { hostnameStatus: 'active', sslStatus: 'pending_validation', workerRouteConfigured: true },
    routeProof: { ok: false, reason: 'TRADING_HOSTNAME_WORKSPACE_MISMATCH', workspaceId: 'ws-other' },
  });

  assert.equal(body.verified, false);
  assert.deepEqual(seen.at(-1), ['sync', 'ws-1', 'h-1', false]);
});

test('does not activate pending SSL hostname when live route proof fails', async () => {
  const { body, seen } = await verify({
    providerState: { hostnameStatus: 'active', sslStatus: 'pending_validation', workerRouteConfigured: true },
    routeProof: { ok: false, reason: 'CUSTOM_HOSTNAME_ROUTE_PROBE_FAILED' },
  });

  assert.equal(body.verified, false);
  assert.deepEqual(seen.at(-1), ['sync', 'ws-1', 'h-1', false]);
});

test('keeps existing strict Cloudflare-active path without requiring live probe', async () => {
  const seen = [];
  const response = await handleAuthorizedV1AdminHostnamesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/hostnames/h-1/verify', { method: 'POST' }),
    AUTH,
    {
      hostnameStore: hostnameStore(seen),
      env: ENV,
      providerClientFactory: () => ({ async getByHostname() { return provider({ hostnameStatus: 'active', sslStatus: 'active', workerRouteConfigured: true }); } }),
      routeProbeFn: async () => { throw new Error('strict active path should not probe'); },
    },
  );
  const body = await response.json();

  assert.equal(body.verified, true);
  assert.deepEqual(seen, [
    ['get', 'ws-1', 'h-1'],
    ['sync', 'ws-1', 'h-1', true],
  ]);
});
