import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTradingEntitlements,
  destinationEntitlementForType,
  hasTradingEntitlement,
} from '../src/security/trading_entitlements.js';

test('normalizes launch entitlements without ever granting live execution', () => {
  const entitlements = normalizeTradingEntitlements({
    tradingExecutionDestination: true,
    telegramDestination: false,
    customSubdomain: true,
    customHostname: false,
    destinations: ['broker_account', 'audit_only'],
    sourceTypes: ['telegram'],
    brokerModes: ['demo', 'live'],
    liveExecution: true,
  });

  assert.equal(entitlements.tradingExecutionDestination, true);
  assert.equal(entitlements.telegramDestination, false);
  assert.equal(entitlements.customSubdomain, true);
  assert.equal(entitlements.customHostname, false);
  assert.equal(entitlements.liveExecution, false);
  assert.deepEqual(entitlements.brokerModes, ['demo']);
});

test('destination entitlement mapping keeps audit-only available and gates Telegram/broker destinations independently', () => {
  assert.equal(destinationEntitlementForType('audit_only'), null);
  assert.equal(destinationEntitlementForType('telegram'), 'telegramDestination');
  assert.equal(destinationEntitlementForType('broker_account'), 'tradingExecutionDestination');
  assert.equal(destinationEntitlementForType('internal_webhook'), 'tradingExecutionDestination');

  const auth = { workspace: { metadata: { entitlements: { tradingExecutionDestination: true, telegramDestination: false } } } };
  assert.equal(hasTradingEntitlement(auth, 'tradingExecutionDestination'), true);
  assert.equal(hasTradingEntitlement(auth, 'telegramDestination'), false);
});

test('legacy destination arrays are normalized into the new capability flags', () => {
  const telegram = normalizeTradingEntitlements({ destinations: ['telegram', 'audit_only'] });
  assert.equal(telegram.telegramDestination, true);
  assert.equal(telegram.tradingExecutionDestination, false);

  const trading = normalizeTradingEntitlements({ destinations: ['broker_account', 'audit_only'] });
  assert.equal(trading.telegramDestination, false);
  assert.equal(trading.tradingExecutionDestination, true);
});
