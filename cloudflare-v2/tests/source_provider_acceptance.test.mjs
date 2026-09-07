import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateProviderFamilyAcceptance,
  evaluateCrossProviderReplay,
} from '../src/testing/source_provider_acceptance.js';

function source(overrides = {}) {
  return {
    id: 'tg-container',
    workspaceId: 'ws-1',
    providerType: 'cloudflare_container_mtproto',
    sourceFamily: 'telegram',
    enabled: true,
    isDefault: true,
    priority: 10,
    externalIdentity: 'acct-1',
    health: { status: 'HEALTHY' },
    ...overrides,
  };
}

test('healthy preferred provider is selected without disabling healthy siblings', () => {
  const result = evaluateProviderFamilyAcceptance({
    workspaceId: 'ws-1',
    sourceFamily: 'telegram',
    sources: [
      source(),
      source({ id: 'tg-external', providerType: 'external_mtproto', isDefault: false, priority: 20 }),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.preferredSourceId, 'tg-container');
  assert.equal(result.selectedSourceId, 'tg-container');
  assert.equal(result.usingFallback, false);
  assert.deepEqual(result.availableSourceIds, ['tg-container', 'tg-external']);
  assert.deepEqual(result.enabledSourceIds, ['tg-container', 'tg-external']);
});

test('unhealthy preferred source falls back locally while another enabled provider remains functioning', () => {
  const result = evaluateProviderFamilyAcceptance({
    workspaceId: 'ws-1',
    sourceFamily: 'telegram',
    sources: [
      source({ health: { status: 'DEGRADED' } }),
      source({ id: 'tg-external', providerType: 'external_mtproto', isDefault: false, priority: 20, health: { status: 'HEALTHY' } }),
      source({ id: 'mt5-a', providerType: 'mt5_source_bridge', sourceFamily: 'mt5', externalIdentity: 'mt5-acct', isDefault: true, health: { status: 'HEALTHY' } }),
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.preferredSourceId, 'tg-container');
  assert.equal(result.selectedSourceId, 'tg-external');
  assert.equal(result.usingFallback, true);
  assert.deepEqual(result.unavailableSourceIds, ['tg-container']);
  assert.equal(result.enabledSourceIds.includes('mt5-a'), false);
});

test('no configured provider fails closed without inventing a global platform failure', () => {
  const result = evaluateProviderFamilyAcceptance({
    workspaceId: 'ws-empty',
    sourceFamily: 'telegram',
    sources: [],
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'NO_ENABLED_PROVIDER',
    workspaceId: 'ws-empty',
    sourceFamily: 'telegram',
    preferredSourceId: null,
    selectedSourceId: null,
    usingFallback: false,
    enabledSourceIds: [],
    availableSourceIds: [],
    unavailableSourceIds: [],
  });
});

test('same native Telegram event from two providers collapses to one workspace-scoped canonical identity', () => {
  const result = evaluateCrossProviderReplay({
    workspaceId: 'ws-1',
    arrivals: [
      {
        source: source(),
        nativeIdentity: { chat_id: '-1001', message_id: '55' },
      },
      {
        source: source({ id: 'tg-external', providerType: 'external_mtproto', isDefault: false }),
        nativeIdentity: { chatId: '-1001', messageId: '55' },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.uniqueEventCount, 1);
  assert.equal(result.duplicateArrivalCount, 1);
  assert.deepEqual(result.canonicalEventIds, ['telegram:acct-1:-1001:55']);
  assert.deepEqual(result.providerSourceIds, ['tg-container', 'tg-external']);
});

test('identical native event in another workspace is not collapsed across tenants', () => {
  const a = evaluateCrossProviderReplay({
    workspaceId: 'ws-a',
    arrivals: [{ source: source({ workspaceId: 'ws-a', externalIdentity: 'acct-shared' }), nativeIdentity: { chat_id: '-1001', message_id: '55' } }],
  });
  const b = evaluateCrossProviderReplay({
    workspaceId: 'ws-b',
    arrivals: [{ source: source({ id: 'tg-b', workspaceId: 'ws-b', externalIdentity: 'acct-shared' }), nativeIdentity: { chat_id: '-1001', message_id: '55' } }],
  });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.canonicalEventIds[0], b.canonicalEventIds[0]);
  assert.notEqual(a.workspaceScopedEventKeys[0], b.workspaceScopedEventKeys[0]);
});

test('arrival from another workspace or disabled source fails acceptance without poisoning valid siblings', () => {
  const badWorkspace = evaluateCrossProviderReplay({
    workspaceId: 'ws-1',
    arrivals: [{ source: source({ workspaceId: 'ws-2' }), nativeIdentity: { chat_id: '-1001', message_id: '1' } }],
  });
  assert.deepEqual(badWorkspace, { ok: false, reason: 'SOURCE_WORKSPACE_MISMATCH', sourceId: 'tg-container' });

  const disabled = evaluateCrossProviderReplay({
    workspaceId: 'ws-1',
    arrivals: [{ source: source({ enabled: false }), nativeIdentity: { chat_id: '-1001', message_id: '1' } }],
  });
  assert.deepEqual(disabled, { ok: false, reason: 'SOURCE_NOT_ENABLED', sourceId: 'tg-container' });
});
