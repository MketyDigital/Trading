import test from 'node:test';
import assert from 'node:assert/strict';
import { createMtprotoRecoveryStore } from '../src/sources/mtproto/recovery_store.js';

function queryHarness(rows = []) {
  const calls = [];
  const builder = {
    select(value) { calls.push(['select', value]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return Promise.resolve({ data: rows, error: null }); },
    update(value) { calls.push(['update', value]); return this; },
    maybeSingle() { calls.push(['maybeSingle']); return Promise.resolve({ data: rows[0] || null, error: null }); },
  };
  return {
    calls,
    supabase: {
      from(table) {
        calls.push(['from', table]);
        return builder;
      },
    },
  };
}

test('lists only active first-party Container MTProto sources with durable recovery metadata', async () => {
  const { supabase, calls } = queryHarness([{
    id: 'source-a',
    workspace_id: 'workspace-a',
    recovery_attempt_count: 2,
    recovery_next_attempt_at: '2026-09-02T09:31:00.000Z',
    last_recovery_at: '2026-09-02T09:29:00.000Z',
    last_recovery_error_code: 'MTPROTO_RECOVERY_FAILED',
  }]);
  const store = createMtprotoRecoveryStore(supabase);

  const sources = await store.listRecoverableSources();

  assert.deepEqual(sources, [{
    id: 'source-a',
    workspaceId: 'workspace-a',
    recoveryAttemptCount: 2,
    recoveryNextAttemptAt: '2026-09-02T09:31:00.000Z',
    lastRecoveryAt: '2026-09-02T09:29:00.000Z',
    lastRecoveryErrorCode: 'MTPROTO_RECOVERY_FAILED',
  }]);
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'provider_type' && call[2] === 'cloudflare_container_mtproto'));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'source_family' && call[2] === 'telegram'));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'is_active' && call[2] === true));
});

test('recovery updates require exact workspace and source identity and write only recovery columns', async () => {
  const { supabase, calls } = queryHarness([{
    id: 'source-a',
    workspace_id: 'workspace-a',
  }]);
  const store = createMtprotoRecoveryStore(supabase);

  await store.updateRecoveryState('workspace-a', 'source-a', {
    recoveryAttemptCount: 1,
    recoveryNextAttemptAt: '2026-09-02T09:30:01.000Z',
    lastRecoveryAt: '2026-09-02T09:30:00.000Z',
    lastRecoveryErrorCode: 'MTPROTO_RECOVERY_FAILED',
    providerSecretCiphertext: 'must-not-write',
  });

  const update = calls.find((call) => call[0] === 'update');
  assert.deepEqual(update[1], {
    recovery_attempt_count: 1,
    recovery_next_attempt_at: '2026-09-02T09:30:01.000Z',
    last_recovery_at: '2026-09-02T09:30:00.000Z',
    last_recovery_error_code: 'MTPROTO_RECOVERY_FAILED',
  });
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'workspace_id' && call[2] === 'workspace-a'));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'id' && call[2] === 'source-a'));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'provider_type' && call[2] === 'cloudflare_container_mtproto'));
});
