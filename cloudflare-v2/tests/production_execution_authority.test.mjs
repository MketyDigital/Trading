import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionAuthorityLoader } from '../src/execution/production_execution_authority.js';

function createSupabase(rows = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const predicates = [];
      const query = {
        select(columns) { calls.push(['select', table, columns]); return query; },
        eq(column, value) { predicates.push([column, String(value)]); calls.push(['eq', table, column, String(value)]); return query; },
        async maybeSingle() {
          calls.push(['maybeSingle', table]);
          const candidates = Array.isArray(rows[table]) ? rows[table] : [];
          const data = candidates.find((row) => predicates.every(([column, value]) => String(row?.[column]) === value)) || null;
          return { data, error: null };
        },
      };
      return query;
    },
  };
}

function validRows(overrides = {}) {
  const event = {
    id: 'evt-db-1',
    workspace_id: 'ws-1',
    source_connection_id: 'src-1',
    ...(overrides.event || {}),
  };
  const source = {
    id: 'src-1',
    workspace_id: 'ws-1',
    is_active: true,
    ...(overrides.source || {}),
  };
  const workspace = {
    id: 'ws-1',
    trading_access_enabled: true,
    ...(overrides.workspace || {}),
  };
  const account = {
    id: 'acct-1',
    workspace_id: 'ws-1',
    platform: 'mt5',
    is_active: true,
    execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false },
    ...(overrides.account || {}),
  };
  return {
    trading_events: [event],
    source_connections: [source],
    trading_workspace_access: [workspace],
    trade_accounts: [account],
  };
}

test('loads exact event source workspace entitlement and account from server-owned durable identity', async () => {
  const supabase = createSupabase(validRows());
  const loader = createProductionExecutionAuthorityLoader({
    supabase,
    workspaceId: 'ws-1',
    tradingEventId: 'evt-db-1',
  });

  const authority = await loader({
    workspaceId: 'ws-1',
    tradingEventId: 'evt-db-1',
    accountId: 'acct-1',
  });

  assert.equal(authority.event.id, 'evt-db-1');
  assert.equal(authority.source.id, 'src-1');
  assert.equal(authority.workspace.id, 'ws-1');
  assert.equal(authority.account.id, 'acct-1');
  assert.equal(authority.source.is_active, true);
  assert.equal(authority.workspace.trading_access_enabled, true);
  assert.equal(authority.account.execution_enabled, true);
  assert.deepEqual(supabase.calls.filter(([name]) => name === 'from').map(([, table]) => table), [
    'trading_events',
    'source_connections',
    'trading_workspace_access',
    'trade_accounts',
  ]);
});

test('rejects caller scope mismatch before querying durable authority', async () => {
  const supabase = createSupabase(validRows());
  const loader = createProductionExecutionAuthorityLoader({
    supabase,
    workspaceId: 'ws-1',
    tradingEventId: 'evt-db-1',
  });

  await assert.rejects(
    () => loader({ workspaceId: 'ws-attacker', tradingEventId: 'evt-db-1', accountId: 'acct-1' }),
    /workspace.*mismatch/i,
  );
  await assert.rejects(
    () => loader({ workspaceId: 'ws-1', tradingEventId: 'evt-attacker', accountId: 'acct-1' }),
    /event.*mismatch/i,
  );
  assert.equal(supabase.calls.length, 0);
});

test('fails closed for missing or cross-workspace persisted event', async () => {
  for (const rows of [
    validRows({ event: { id: 'other-event' } }),
    validRows({ event: { workspace_id: 'ws-other' } }),
  ]) {
    const loader = createProductionExecutionAuthorityLoader({
      supabase: createSupabase(rows), workspaceId: 'ws-1', tradingEventId: 'evt-db-1',
    });
    await assert.rejects(
      () => loader({ workspaceId: 'ws-1', tradingEventId: 'evt-db-1', accountId: 'acct-1' }),
      /event.*(unavailable|workspace|authority)/i,
    );
  }
});

test('fails closed when originating source is missing inactive or outside the event workspace', async () => {
  const cases = [
    { source: { id: 'other-source' } },
    { source: { is_active: false } },
    { source: { workspace_id: 'ws-other' } },
  ];
  for (const change of cases) {
    const loader = createProductionExecutionAuthorityLoader({
      supabase: createSupabase(validRows(change)), workspaceId: 'ws-1', tradingEventId: 'evt-db-1',
    });
    await assert.rejects(
      () => loader({ workspaceId: 'ws-1', tradingEventId: 'evt-db-1', accountId: 'acct-1' }),
      /source.*(unavailable|inactive|workspace|authority)/i,
    );
  }
});

test('fails closed when exact workspace entitlement is missing or disabled', async () => {
  const missing = validRows();
  missing.trading_workspace_access = [];
  for (const rows of [missing, validRows({ workspace: { trading_access_enabled: false } })]) {
    const loader = createProductionExecutionAuthorityLoader({
      supabase: createSupabase(rows), workspaceId: 'ws-1', tradingEventId: 'evt-db-1',
    });
    await assert.rejects(
      () => loader({ workspaceId: 'ws-1', tradingEventId: 'evt-db-1', accountId: 'acct-1' }),
      /workspace.*(unavailable|disabled|entitlement|authority)/i,
    );
  }
});

test('fails closed when exact account is missing foreign inactive or execution-disabled', async () => {
  const cases = [];
  const missing = validRows();
  missing.trade_accounts = [];
  cases.push(missing);
  cases.push(validRows({ account: { workspace_id: 'ws-other' } }));
  cases.push(validRows({ account: { is_active: false } }));
  cases.push(validRows({ account: { execution_enabled: false } }));

  for (const rows of cases) {
    const loader = createProductionExecutionAuthorityLoader({
      supabase: createSupabase(rows), workspaceId: 'ws-1', tradingEventId: 'evt-db-1',
    });
    await assert.rejects(
      () => loader({ workspaceId: 'ws-1', tradingEventId: 'evt-db-1', accountId: 'acct-1' }),
      /account.*(unavailable|workspace|inactive|execution|authority)/i,
    );
  }
});
