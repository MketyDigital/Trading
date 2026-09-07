import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingMembershipStore } from '../src/security/trading_membership_store.js';

function makeSupabase({ row = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const chain = {
        select(columns) { calls.push(['select', columns]); return chain; },
        eq(column, value) { calls.push(['eq', column, value]); return chain; },
        maybeSingle: async () => ({ data: row, error }),
      };
      return chain;
    },
  };
}

test('membership store resolves exact workspace and Zitadel subject only', async () => {
  const supabase = makeSupabase({
    row: {
      id: 'membership-1',
      workspace_id: 'ws-1',
      zitadel_subject: 'zitadel-user-1',
      trading_role: 'admin',
      membership_enabled: true,
      metadata: { source: 'enterprise' },
    },
  });
  const store = createTradingMembershipStore(supabase);
  const membership = await store.getMembership('ws-1', 'zitadel-user-1');

  assert.deepEqual(membership, {
    id: 'membership-1',
    workspaceId: 'ws-1',
    subject: 'zitadel-user-1',
    role: 'admin',
    enabled: true,
    metadata: { source: 'enterprise' },
  });
  assert.deepEqual(supabase.calls.filter((call) => call[0] === 'eq'), [
    ['eq', 'workspace_id', 'ws-1'],
    ['eq', 'zitadel_subject', 'zitadel-user-1'],
  ]);
});

test('membership store returns null for absent membership and fails closed on database error', async () => {
  const empty = createTradingMembershipStore(makeSupabase());
  assert.equal(await empty.getMembership('ws-1', 'u-1'), null);

  const broken = createTradingMembershipStore(makeSupabase({ error: { message: 'db unavailable' } }));
  await assert.rejects(() => broken.getMembership('ws-1', 'u-1'), /TRADING_MEMBERSHIP_LOOKUP_FAILED/);
});

test('membership store requires a server-side database client', () => {
  assert.throws(() => createTradingMembershipStore(null), /TRADING_MEMBERSHIP_STORE_UNAVAILABLE/);
});
