import test from 'node:test';
import assert from 'node:assert/strict';

import { validateProviderConfiguration } from '../src/sources/provider_config_validation.js';

const workspaceId = 'ws-coexist';

function source(overrides = {}) {
  return {
    id: 'source-1',
    workspaceId,
    providerType: 'tradingview_webhook',
    sourceFamily: 'tradingview',
    enabled: true,
    isDefault: true,
    priority: 10,
    externalIdentity: 'scope-1',
    config: {},
    ...overrides,
  };
}

test('all supported provider families can be configured independently in one workspace', () => {
  const records = [
    source({
      id: 'tg-container',
      providerType: 'cloudflare_container_mtproto',
      sourceFamily: 'telegram',
      externalIdentity: 'telegram-account-1',
      config: { chat_ids: ['-1001', '-1002'] },
    }),
    source({
      id: 'tg-external',
      providerType: 'external_mtproto',
      sourceFamily: 'telegram',
      isDefault: false,
      priority: 20,
      externalIdentity: 'telegram-account-1',
      config: { chat_acceptance_mode: 'allowlist', allowed_chat_ids: ['-1001'] },
    }),
    source({ id: 'mt5-source', providerType: 'mt5_source_bridge', sourceFamily: 'mt5', externalIdentity: 'mt5-terminal-1' }),
    source({ id: 'ctrader-source', providerType: 'ctrader_source', sourceFamily: 'ctrader', externalIdentity: 'ctrader-account-1' }),
    source({ id: 'tv-source', providerType: 'tradingview_webhook', sourceFamily: 'tradingview', externalIdentity: 'tv-strategy-1' }),
    source({ id: 'custom-source', providerType: 'custom_signed_api', sourceFamily: 'custom_api', externalIdentity: 'custom-client-1' }),
  ];

  const results = records.map((record) => validateProviderConfiguration(record));
  assert.equal(results.every((result) => result.ok), true);
  assert.deepEqual(results.map((result) => result.source.id), records.map((record) => record.id));
});

test('invalid configuration is scoped to only the provider being validated', () => {
  const invalidContainer = source({
    id: 'tg-container',
    providerType: 'cloudflare_container_mtproto',
    sourceFamily: 'telegram',
    externalIdentity: 'telegram-account-1',
    config: { chat_ids: [] },
  });
  const healthyTradingView = source({
    id: 'tv-source',
    providerType: 'tradingview_webhook',
    sourceFamily: 'tradingview',
    externalIdentity: 'tv-strategy-1',
  });

  const bad = validateProviderConfiguration(invalidContainer);
  const good = validateProviderConfiguration(healthyTradingView);

  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'MTPROTO_CHAT_IDS_NOT_CONFIGURED');
  assert.equal(bad.sourceId, 'tg-container');
  assert.equal(good.ok, true);
  assert.equal(good.source.id, 'tv-source');
});

test('provider validation rejects family mismatch and missing canonical scope without mutating sibling defaults', () => {
  const sibling = source({
    id: 'mt5-default',
    providerType: 'mt5_source_bridge',
    sourceFamily: 'mt5',
    externalIdentity: 'mt5-terminal-1',
    isDefault: true,
  });
  const siblingSnapshot = structuredClone(sibling);

  const mismatch = validateProviderConfiguration(source({
    id: 'bad-family',
    providerType: 'ctrader_source',
    sourceFamily: 'mt5',
    externalIdentity: 'ctrader-account-1',
  }));
  const missingScope = validateProviderConfiguration(source({
    id: 'missing-scope',
    providerType: 'custom_signed_api',
    sourceFamily: 'custom_api',
    externalIdentity: '   ',
  }));
  const healthySibling = validateProviderConfiguration(sibling);

  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'SOURCE_PROVIDER_FAMILY_MISMATCH');
  assert.equal(missingScope.ok, false);
  assert.equal(missingScope.reason, 'SOURCE_EXTERNAL_IDENTITY_REQUIRED');
  assert.equal(healthySibling.ok, true);
  assert.deepEqual(sibling, siblingSnapshot);
});

test('external mtproto transport forwarding cannot weaken server chat policy validation', () => {
  const invalidMode = validateProviderConfiguration(source({
    id: 'tg-external',
    providerType: 'external_mtproto',
    sourceFamily: 'telegram',
    externalIdentity: 'telegram-account-1',
    config: { chat_acceptance_mode: 'forward_all', allowed_chat_ids: [] },
  }));

  assert.equal(invalidMode.ok, false);
  assert.equal(invalidMode.reason, 'MTPROTO_SOURCE_POLICY_INVALID');

  const explicitAllVisible = validateProviderConfiguration(source({
    id: 'tg-external-visible',
    providerType: 'external_mtproto',
    sourceFamily: 'telegram',
    externalIdentity: 'telegram-account-1',
    config: { chat_acceptance_mode: 'all_visible' },
  }));
  assert.equal(explicitAllVisible.ok, true);
});

test('validation output contains non-secret normalized config only and does not invent execution coupling', () => {
  const input = source({
    id: 'custom-source',
    providerType: 'custom_signed_api',
    sourceFamily: 'custom_api',
    externalIdentity: 'custom-client-1',
    config: { label: 'signals-api' },
    brokerAccountId: 'must-not-be-copied',
    executionEnabled: true,
  });

  const result = validateProviderConfiguration(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.source.config, { label: 'signals-api' });
  assert.equal('brokerAccountId' in result.source, false);
  assert.equal('executionEnabled' in result.source, false);
});
