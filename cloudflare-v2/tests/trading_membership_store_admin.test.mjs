import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingMembershipStore } from '../src/security/trading_membership_store.js';

function row(subject = 'u-1', overrides = {}) {
  return {
    id: `m-${subject}`,
    workspace_id: 'ws-1',
    zitadel_subject: subject,
    trading_role: 'viewer',
    membership_enabled: true,
    metadata: {},
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeSupabase({ listRows = [row()], singleRow = row(), count = 1 } = {}) {
  const calls = [];
  const makeChain = () => {
    const chain = {
      select(columns, options) { calls.push(['select', columns, options ?? null]); return chain; },
      eq(column, value) { calls.push(['eq', column, value]); return chain; },
      order(column, options) { calls.push(['order', column, options]); return Promise.resolve({ data: listRows, error: null }); },
      upsert(value, options) { calls.push(['upsert', value, options]); return chain; },
      update(value) { calls.push(['update', value]); return chain; },
      maybeSingle: async () => ({ data: singleRow, error: null }),
      then(resolve, reject) {
        return Promise.resolve({ data: null, error: null, count }).then(resolve, reject);
      },
    };
    return chain;
  };
  return {
    calls,
    from(table) { calls.push(['from', table]); return makeChain(); },
  };
}

test('list memberships is exact-workspace and returns normalized safe records', async () => {
  const supabase = makeSupabase({ listRows: [row('u-1'), row('u-2', { trading_role: 'admin' })] });
  const store = createTradingMembershipStore(supabase);
  const members = await store.listMemberships('ws-1');
  assert.deepEqual(members.map((item) => [item.subject, item.role]), [['u-1', 'viewer'], ['u-2', 'admin']]);
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'workspace_id' && call[2] === 'ws-1'));
});

test('upsert membership scopes the immutable subject to exact workspace', async () => {
  const supabase = makeSupabase({ singleRow: row('trading-only', { trading_role: 'operator' }) });
  const store = createTradingMembershipStore(supabase);
  const result = await store.upsertMembership('ws-1', 'trading-only', 'operator');
  assert.equal(result.subject, 'trading-only');
  const upsert = supabase.calls.find((call) => call[0] === 'upsert');
  assert.equal(upsert[1].workspace_id, 'ws-1');
  assert.equal(upsert[1].zitadel_subject, 'trading-only');
  assert.equal(upsert[1].trading_role, 'operator');
  assert.equal(upsert[1].membership_enabled, true);
  assert.equal(upsert[2].onConflict, 'workspace_id,zitadel_subject');
});

test('role and enabled mutations always include workspace and subject predicates', async () => {
  const supabase = makeSupabase({ singleRow: row('u-1', { trading_role: 'admin' }) });
  const store = createTradingMembershipStore(supabase);
  await store.setMembershipRole('ws-1', 'u-1', 'admin');
  await store.setMembershipEnabled('ws-1', 'u-1', false);

  const eqCalls = supabase.calls.filter((call) => call[0] === 'eq');
  assert.ok(eqCalls.filter((call) => call[1] === 'workspace_id' && call[2] === 'ws-1').length >= 2);
  assert.ok(eqCalls.filter((call) => call[1] === 'zitadel_subject' && call[2] === 'u-1').length >= 2);
});

test('enabled owner count is exact workspace and owner-only', async () => {
  const supabase = makeSupabase({ count: 2 });
  const store = createTradingMembershipStore(supabase);
  assert.equal(await store.countEnabledOwners('ws-1'), 2);
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'workspace_id' && call[2] === 'ws-1'));
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'trading_role' && call[2] === 'owner'));
  assert.ok(supabase.calls.some((call) => call[0] === 'eq' && call[1] === 'membership_enabled' && call[2] === true));
});
