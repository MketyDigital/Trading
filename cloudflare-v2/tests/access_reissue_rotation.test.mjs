import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMketyAdminAccessCodePlan,
  mergeAccessEntitlements,
  mergeWorkspaceAccessMetadata,
} from '../src/http/v1_mkety_admin_access_codes.js';
import {
  createLocalTradingBearer,
  createTradingRefreshToken,
  verifyLocalTradingBearer,
  verifyTradingRefreshToken,
} from '../src/access/trading_access_codes.js';
import { createTradingAccessCodeStore } from '../src/persistence/supabase_access_code_store.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const subject = 'access-code:owner@example.com';

function sessionSupabase(currentAccessCodeId = 'code-new', membershipAccessCodeId = currentAccessCodeId) {
  return {
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(column, value) { filters[column] = value; return this; },
        async maybeSingle() {
          if (table === 'trading_workspace_access') {
            return {
              data: {
                id: workspaceId,
                display_name: 'Starpips Forex',
                owner_email: 'owner@example.com',
                trading_access_enabled: true,
                metadata: {
                  branding: { brandName: 'Starpips Forex', accentColor: '#006FFF' },
                  customSetting: 'keep-me',
                  accessCodeId: currentAccessCodeId,
                  entitlements: {
                    brokerModes: ['demo'],
                    sourceTypes: ['telegram', 'tradingview'],
                    destinations: ['broker_account', 'telegram', 'audit_only'],
                    liveExecution: false,
                    tradingExecutionDestination: true,
                    telegramDestination: true,
                  },
                },
              },
              error: null,
            };
          }
          if (table === 'trading_workspace_memberships') {
            assert.equal(filters.workspace_id, workspaceId);
            assert.equal(filters.zitadel_subject, subject);
            return {
              data: {
                workspace_id: workspaceId,
                zitadel_subject: subject,
                trading_role: 'owner',
                membership_enabled: true,
                metadata: {
                  accessCodeId: membershipAccessCodeId,
                  entitlements: {
                    brokerModes: ['demo'],
                    sourceTypes: ['telegram', 'tradingview'],
                    destinations: ['broker_account', 'telegram', 'audit_only'],
                    liveExecution: false,
                    tradingExecutionDestination: true,
                    telegramDestination: true,
                  },
                },
              },
              error: null,
            };
          }
          if (table === 'trading_access_codes') {
            assert.equal(filters.id, currentAccessCodeId);
            return {
              data: {
                id: currentAccessCodeId,
                workspace_id: workspaceId,
                product: 'trading',
                status: 'active',
                expires_at: '2099-01-01T00:00:00.000Z',
              },
              error: null,
            };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
    },
  };
}

test('reissue merges access without erasing branding or unrelated workspace metadata', () => {
  const existing = {
    branding: {
      brandName: 'Starpips Forex',
      productName: 'Trading',
      logoUrl: 'https://example.com/starpips.png',
      accentColor: '#006FFF',
      hideMketyBranding: true,
    },
    customSetting: 'keep-me',
    accessCodeId: 'code-old',
    entitlements: {
      brokerModes: ['demo'],
      sourceTypes: ['tradingview'],
      destinations: ['broker_account', 'audit_only'],
      liveExecution: false,
      tradingExecutionDestination: true,
      telegramDestination: false,
      customSubdomain: true,
      customHostname: true,
    },
  };
  const requested = {
    brokerModes: ['demo'],
    sourceTypes: ['telegram', 'tradingview'],
    destinations: ['telegram', 'audit_only'],
    liveExecution: false,
    tradingExecutionDestination: true,
    telegramDestination: true,
    customSubdomain: false,
    customHostname: false,
  };

  const entitlements = mergeAccessEntitlements(existing.entitlements, requested);
  const metadata = mergeWorkspaceAccessMetadata(existing, {
    accessCodeId: 'code-new',
    entitlements,
    accessCodeProvisioned: true,
  });

  assert.deepEqual(metadata.branding, existing.branding);
  assert.equal(metadata.customSetting, 'keep-me');
  assert.equal(metadata.accessCodeId, 'code-new');
  assert.equal(metadata.entitlements.telegramDestination, true);
  assert.equal(metadata.entitlements.tradingExecutionDestination, true);
  assert.equal(metadata.entitlements.customSubdomain, true);
  assert.equal(metadata.entitlements.customHostname, true);
  assert.deepEqual(metadata.entitlements.brokerModes, ['demo']);
  assert.equal(metadata.entitlements.liveExecution, false);
  assert.deepEqual(new Set(metadata.entitlements.destinations), new Set(['broker_account', 'telegram', 'audit_only']));
  assert.deepEqual(new Set(metadata.entitlements.sourceTypes), new Set(['tradingview', 'telegram']));
});

test('plan marks an existing workspace request as a reissue without changing workspace identity', async () => {
  const plan = await createMketyAdminAccessCodePlan({
    code: 'TRD-MKETY-ROTATE-001',
    ownerEmail: 'owner@example.com',
    ownerName: 'Owner',
    workspaceName: 'Starpips Forex',
    workspaceId,
    entitlements: { telegramDestination: true, destinations: ['telegram', 'audit_only'] },
  }, { randomUUID: () => 'must-not-be-used-for-workspace' });

  assert.equal(plan.ok, true);
  assert.equal(plan.reissue, true);
  assert.equal(plan.workspace.id, workspaceId);
  assert.equal(plan.entitlements.liveExecution, false);
  assert.deepEqual(plan.entitlements.brokerModes, ['demo']);
});

test('local bearer and refresh token carry the access-code binding used for rotation invalidation', async () => {
  const bearer = await createLocalTradingBearer({ subject, workspaceId, access: 'owner', accessCodeId: 'code-new' }, 'secret', 1000);
  const verifiedBearer = await verifyLocalTradingBearer(bearer, 'secret', { requestedWorkspaceId: workspaceId, nowSec: 1001 });
  assert.equal(verifiedBearer.ok, true);
  assert.equal(verifiedBearer.accessCodeId, 'code-new');

  const refresh = await createTradingRefreshToken({ subject, workspaceId, accessCodeId: 'code-new' }, 'secret', 1000);
  const verifiedRefresh = await verifyTradingRefreshToken(refresh, 'secret', { nowSec: 1001 });
  assert.equal(verifiedRefresh.ok, true);
  assert.equal(verifiedRefresh.accessCodeId, 'code-new');
});

test('returning session rejects a superseded access-code binding immediately even when membership metadata is stale', async () => {
  const store = createTradingAccessCodeStore(sessionSupabase('code-new', 'code-old'));

  const stale = await store.restoreSession({ workspaceId, subject, accessCodeId: 'code-old' });
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 401);
  assert.equal(stale.reason, 'ACCESS_SESSION_SUPERSEDED');

  const current = await store.restoreSession({ workspaceId, subject, accessCodeId: 'code-new' });
  assert.equal(current.ok, true);
  assert.equal(current.codeId, 'code-new');
  assert.equal(current.workspace.id, workspaceId);
});
