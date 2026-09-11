import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNoCustomerSpecificRequiredEnvironment,
  isCustomerSpecificEnvironmentKey,
  isPlatformBootstrapKey,
} from '../src/config/config_ownership.js';

test('platform bootstrap secrets remain valid deployment configuration', () => {
  for (const key of ['TRADING_MASTER_KEY', 'SUPABASE_SERVICE_ROLE', 'CBOT_TOKEN_SIGNING_KEY', 'CTRADER_CLIENT_ID']) {
    assert.equal(isPlatformBootstrapKey(key), true, key);
    assert.equal(isCustomerSpecificEnvironmentKey(key), false, key);
  }
});

test('customer trading configuration is classified as database-authoritative', () => {
  for (const key of [
    'MT5_ACCOUNT_ID', 'MT5_LOGIN', 'MT5_SERVER', 'MT5_PASSWORD', 'MT5_BRIDGE_URL', 'MT5_BRIDGE_SECRET',
    'CTRADER_ACCOUNT_ID', 'CTRADER_BROKER', 'CTRADER_SYMBOL', 'ALLOWED_CHAT_IDS', 'TELEGRAM_ACCOUNT_SCOPE',
  ]) assert.equal(isCustomerSpecificEnvironmentKey(key), true, key);
});

test('deployment-required customer configuration is rejected by ownership guard', () => {
  assert.throws(
    () => assertNoCustomerSpecificRequiredEnvironment(['TRADING_MASTER_KEY', 'MT5_ACCOUNT_ID', 'ALLOWED_CHAT_IDS']),
    (error) => error?.code === 'CUSTOMER_CONFIGURATION_MUST_USE_DATABASE'
      && error.invalidKeys.includes('MT5_ACCOUNT_ID')
      && error.invalidKeys.includes('ALLOWED_CHAT_IDS'),
  );
});
