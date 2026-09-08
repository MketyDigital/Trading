import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStagingReadiness } from '../src/config/staging_readiness.js';

function accessCodeEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://staging.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-role',
    TRADING_MASTER_KEY: 'master-key',
    TRADING_ACCESS_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'session-secret',
    ...overrides,
  };
}

test('access-code session auth satisfies trading readiness without central identity config', () => {
  const result = validateStagingReadiness(accessCodeEnv());
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.features.accessEnabled, true);
  assert.equal(result.features.localAccessCodeAuthEnabled, true);
  assert.equal(result.features.centralAccessAuthEnabled, false);
});

test('access-code session mode fails closed if its signing secret is missing', () => {
  const result = validateStagingReadiness(accessCodeEnv({ TRADING_ACCESS_CODE_SESSION_SECRET: undefined }));
  assert.equal(result.ready, false);
  assert.equal(result.missing.includes('TRADING_ACCESS_CODE_SESSION_SECRET'), true);
});
