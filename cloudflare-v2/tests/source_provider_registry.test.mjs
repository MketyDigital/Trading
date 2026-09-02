import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_FAMILIES,
  PROVIDER_TYPES,
  getProviderDefinition,
  normalizeProviderRecord,
} from '../src/sources/provider_registry.js';

test('provider registry exposes all initial source provider types', () => {
  assert.equal(PROVIDER_TYPES.CLOUDFLARE_CONTAINER_MTPROTO, 'cloudflare_container_mtproto');
  assert.equal(PROVIDER_TYPES.CLOUDFLARE_DO_MTPROTO, 'cloudflare_do_mtproto');
  assert.equal(PROVIDER_TYPES.EXTERNAL_MTPROTO, 'external_mtproto');
  assert.equal(PROVIDER_TYPES.TRADINGVIEW_WEBHOOK, 'tradingview_webhook');
  assert.equal(PROVIDER_TYPES.MT5_SOURCE_BRIDGE, 'mt5_source_bridge');
  assert.equal(PROVIDER_TYPES.CTRADER_SOURCE, 'ctrader_source');
  assert.equal(PROVIDER_TYPES.CUSTOM_SIGNED_API, 'custom_signed_api');
});

test('provider definitions map runtimes to the correct source families', () => {
  assert.equal(getProviderDefinition('cloudflare_container_mtproto').sourceFamily, SOURCE_FAMILIES.TELEGRAM);
  assert.equal(getProviderDefinition('cloudflare_do_mtproto').sourceFamily, SOURCE_FAMILIES.TELEGRAM);
  assert.equal(getProviderDefinition('external_mtproto').sourceFamily, SOURCE_FAMILIES.TELEGRAM);
  assert.equal(getProviderDefinition('tradingview_webhook').sourceFamily, SOURCE_FAMILIES.TRADINGVIEW);
  assert.equal(getProviderDefinition('mt5_source_bridge').sourceFamily, SOURCE_FAMILIES.MT5);
  assert.equal(getProviderDefinition('ctrader_source').sourceFamily, SOURCE_FAMILIES.CTRADER);
  assert.equal(getProviderDefinition('custom_signed_api').sourceFamily, SOURCE_FAMILIES.CUSTOM_API);
});

test('unknown providers fail closed', () => {
  assert.throws(() => getProviderDefinition('mystery_provider'), /unknown source provider/i);
});

test('normalizeProviderRecord keeps defaults as preference rather than exclusivity', () => {
  const normalized = normalizeProviderRecord({
    id: 'src-1',
    workspaceId: 'ws-1',
    providerType: 'external_mtproto',
    sourceFamily: 'telegram',
    enabled: true,
    isDefault: true,
    priority: 10,
  });

  assert.deepEqual(normalized, {
    id: 'src-1',
    workspaceId: 'ws-1',
    providerType: 'external_mtproto',
    sourceFamily: 'telegram',
    enabled: true,
    isDefault: true,
    priority: 10,
  });
});

test('normalizeProviderRecord rejects provider/source-family mismatches', () => {
  assert.throws(
    () => normalizeProviderRecord({
      id: 'src-2',
      workspaceId: 'ws-1',
      providerType: 'ctrader_source',
      sourceFamily: 'telegram',
      enabled: true,
      isDefault: false,
      priority: 0,
    }),
    /source family/i,
  );
});
