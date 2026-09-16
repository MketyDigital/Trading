import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createOperationJournal } from '../src/observability/operation_journal.js';

function captureSupabase() {
  const inserts = [];
  return {
    inserts,
    from(table) {
      assert.equal(table, 'trading_operation_journal');
      return {
        async insert(row) {
          inserts.push(structuredClone(row));
          return { data: null, error: null };
        },
      };
    },
  };
}

test('operation journal appends normalized evidence without becoming execution authority', async () => {
  const supabase = captureSupabase();
  const journal = createOperationJournal(supabase, { nowFn: () => new Date('2026-09-16T23:10:00.000Z') });

  const result = await journal.record({
    workspaceId: '11111111-1111-1111-1111-111111111111',
    tradingEventId: '22222222-2222-2222-2222-222222222222',
    sourceConnectionId: '33333333-3333-3333-3333-333333333333',
    sourceFeedId: '44444444-4444-4444-4444-444444444444',
    routeId: '55555555-5555-5555-5555-555555555555',
    destinationId: '66666666-6666-6666-6666-666666666666',
    destinationDeliveryId: '77777777-7777-7777-7777-777777777777',
    tradeAccountId: '88888888-8888-8888-8888-888888888888',
    positionGroupId: '99999999-9999-9999-9999-999999999999',
    runtimeGroupId: 'event-317/account-demo',
    aiProviderId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    correlationId: 'telegram:-100123:317',
    stage: 'BROKER_EXECUTION',
    operation: 'MODIFY_POSITION',
    status: 'SUCCEEDED',
    retryable: false,
    diagnostic: {
      broker: 'ctrader',
      providerCode: 'OK',
      nested: {
        authorization: 'Bearer must-never-persist',
        api_key: 'secret-key',
        password: 'secret-password',
        safe: 'kept',
      },
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(supabase.inserts.length, 1);
  const row = supabase.inserts[0];
  assert.equal(row.workspace_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(row.trading_event_id, '22222222-2222-2222-2222-222222222222');
  assert.equal(row.runtime_group_id, 'event-317/account-demo');
  assert.equal(row.correlation_id, 'telegram:-100123:317');
  assert.equal(row.stage, 'BROKER_EXECUTION');
  assert.equal(row.operation, 'MODIFY_POSITION');
  assert.equal(row.status, 'SUCCEEDED');
  assert.equal(row.occurred_at, '2026-09-16T23:10:00.000Z');
  assert.equal(row.diagnostic.nested.safe, 'kept');
  assert.equal('authorization' in row.diagnostic.nested, false);
  assert.equal('api_key' in row.diagnostic.nested, false);
  assert.equal('password' in row.diagnostic.nested, false);
  assert.equal(JSON.stringify(row).includes('must-never-persist'), false);
  assert.equal(JSON.stringify(row).includes('secret-key'), false);
  assert.equal(typeof journal.retry, 'undefined');
  assert.equal(typeof journal.resend, 'undefined');
  assert.equal(typeof journal.execute, 'undefined');
});

test('journal fails closed on invalid taxonomy or missing workspace/correlation authority', async () => {
  const supabase = captureSupabase();
  const journal = createOperationJournal(supabase);

  for (const input of [
    { workspaceId: '', correlationId: 'corr', stage: 'INGRESS', operation: 'RECEIVE', status: 'SUCCEEDED' },
    { workspaceId: 'ws-1', correlationId: '', stage: 'INGRESS', operation: 'RECEIVE', status: 'SUCCEEDED' },
    { workspaceId: 'ws-1', correlationId: 'corr', stage: 'UNKNOWN_STAGE', operation: 'RECEIVE', status: 'SUCCEEDED' },
    { workspaceId: 'ws-1', correlationId: 'corr', stage: 'INGRESS', operation: 'RECEIVE', status: 'UNKNOWN_STATUS' },
  ]) {
    const result = await journal.record(input);
    assert.equal(result.ok, false);
    assert.match(result.reason, /^OPERATION_JOURNAL_/);
  }
  assert.equal(supabase.inserts.length, 0);
});

test('journal insert failure is observational and reports failure without execution/retry authority', async () => {
  const journal = createOperationJournal({
    from() {
      return { async insert() { return { data: null, error: { message: 'db unavailable' } }; } };
    },
  });
  const result = await journal.record({
    workspaceId: 'ws-1', correlationId: 'corr-1', stage: 'ROUTING', operation: 'ROUTE_SELECTED', status: 'SUCCEEDED',
  });
  assert.deepEqual(result, { ok: false, reason: 'OPERATION_JOURNAL_PERSIST_FAILED' });
});

test('migration 0042 creates append-only journal with pagination and correlation indexes', async () => {
  const sql = await readFile(new URL('../db/migrations/0042_trading_operation_journal.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.trading_operation_journal/i);
  assert.match(sql, /workspace_id\s+UUID\s+NOT\s+NULL/i);
  assert.match(sql, /correlation_id\s+TEXT\s+NOT\s+NULL/i);
  assert.match(sql, /diagnostic\s+JSONB\s+NOT\s+NULL/i);
  assert.match(sql, /runtime_group_id\s+TEXT/i);
  assert.match(sql, /workspace_id\s*,\s*occurred_at\s+DESC/i);
  assert.match(sql, /trading_event_id\s*,\s*occurred_at\s+DESC/i);
  assert.match(sql, /correlation_id\s*,\s*occurred_at\s+DESC/i);
  assert.match(sql, /stage\s*,\s*status\s*,\s*occurred_at\s+DESC/i);
  assert.match(sql, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
});
