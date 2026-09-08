import test from 'node:test';
import assert from 'node:assert/strict';

import { handleAuthorizedV1AdminHostnamesRequest } from '../src/http/v1_admin_hostnames.js';

function auth(entitlements, { accessCodeProvisioned = true } = {}) {
  return {
    workspace: { id: 'ws-1', metadata: { accessCodeProvisioned, entitlements } },
    membership: { role: 'owner' },
  };
}

test('custom hostname admin API fails closed when access code did not grant hostname capability', async () => {
  let storeCalls = 0;
  const response = await handleAuthorizedV1AdminHostnamesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/hostnames'),
    auth({ customHostname: false, destinations: ['audit_only'] }),
    {
      hostnameStore: {
        async list() { storeCalls += 1; return []; },
      },
      env: {},
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, reason: 'TRADING_ENTITLEMENT_REQUIRED' });
  assert.equal(storeCalls, 0);
});

test('custom hostname admin API remains available when hostname capability is granted', async () => {
  const response = await handleAuthorizedV1AdminHostnamesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/hostnames'),
    auth({ customHostname: true, destinations: ['audit_only'] }),
    { hostnameStore: { async list() { return []; } }, env: {} },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('existing non-access-code enterprise workspace keeps current hostname behavior', async () => {
  const response = await handleAuthorizedV1AdminHostnamesRequest(
    new Request('https://trade.mkety.com/api/v1/admin/hostnames'),
    auth({}, { accessCodeProvisioned: false }),
    { hostnameStore: { async list() { return []; } }, env: {} },
  );

  assert.equal(response.status, 200);
});
