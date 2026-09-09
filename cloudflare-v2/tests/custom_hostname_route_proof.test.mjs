import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleCustomHostnameRouteProofRequest,
  probeCustomHostnameRoute,
} from '../src/security/custom_hostname_route_proof.js';

const ENV = { TRADING_ACCESS_CODE_SESSION_SECRET: 'route-proof-test-secret' };

function supabaseRow(row) {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_hostnames');
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  };
}

test('signed route proof round-trips for the expected hostname and workspace', async () => {
  const supabase = supabaseRow({
    hostname: 'copier.starpipsforex.com',
    workspace_id: 'ws-1',
    status: 'pending',
  });

  const fetchFn = async (url, options) => {
    assert.equal(options.redirect, 'error');
    return handleCustomHostnameRouteProofRequest(new Request(url, options), ENV, { supabase });
  };

  const result = await probeCustomHostnameRoute(
    'copier.starpipsforex.com',
    'ws-1',
    ENV,
    { fetchFn, nonceFactory: () => 'abcdefghijklmnop1234567890' },
  );

  assert.deepEqual(result, {
    ok: true,
    hostname: 'copier.starpipsforex.com',
    workspaceId: 'ws-1',
  });
});

test('signed route proof rejects the same routed hostname for a different workspace', async () => {
  const supabase = supabaseRow({
    hostname: 'copier.starpipsforex.com',
    workspace_id: 'ws-1',
    status: 'pending',
  });
  const fetchFn = (url, options) => handleCustomHostnameRouteProofRequest(new Request(url, options), ENV, { supabase });

  const result = await probeCustomHostnameRoute(
    'copier.starpipsforex.com',
    'ws-other',
    ENV,
    { fetchFn, nonceFactory: () => 'abcdefghijklmnop1234567890' },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TRADING_HOSTNAME_WORKSPACE_MISMATCH');
});

test('route proof endpoint does not expose workspace id or signing secret', async () => {
  const response = await handleCustomHostnameRouteProofRequest(
    new Request('https://copier.starpipsforex.com/api/v1/custom-hostname/probe?nonce=abcdefghijklmnop1234567890'),
    ENV,
    { supabase: supabaseRow({ hostname: 'copier.starpipsforex.com', workspace_id: 'ws-secret-id', status: 'pending' }) },
  );
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(text.includes('ws-secret-id'), false);
  assert.equal(text.includes('route-proof-test-secret'), false);
});
