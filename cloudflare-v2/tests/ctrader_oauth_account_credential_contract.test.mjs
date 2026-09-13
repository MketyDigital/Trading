import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCompleteCTraderCredentials } from '../src/http/v1_admin_connections_account_controls.js';

test('cTrader OAuth credential completion combines app credentials with account tokens', () => {
  assert.deepEqual(
    buildCompleteCTraderCredentials(
      { accessToken: 'access-token', refreshToken: 'refresh-token' },
      { CTRADER_CLIENT_ID: 'client-id', CTRADER_CLIENT_SECRET: 'client-secret' },
    ),
    {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    },
  );
});

test('cTrader OAuth credential completion fails closed when any required credential is missing', () => {
  assert.throws(
    () => buildCompleteCTraderCredentials(
      { accessToken: 'access-token', refreshToken: 'refresh-token' },
      { CTRADER_CLIENT_ID: 'client-id' },
    ),
    /CTRADER_CLIENT_SECRET_REQUIRED/,
  );
  assert.throws(
    () => buildCompleteCTraderCredentials(
      { accessToken: 'access-token' },
      { CTRADER_CLIENT_ID: 'client-id', CTRADER_CLIENT_SECRET: 'client-secret' },
    ),
    /CTRADER_REFRESH_TOKEN_REQUIRED/,
  );
});
