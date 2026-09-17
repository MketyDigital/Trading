import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSupabaseIngestStores } from '../src/storage/supabase_ingest_store.js';

function revisionRow(overrides = {}) {
  return {
    workspace_id: 'ws-1',
    trading_event_id: 'evt-1',
    revision_key: `sha256:${'a'.repeat(64)}`,
    event_version: '1.0',
    source_type: 'telegram_bot',
    source_external_id: '-100123',
    external_event_id: '-100123:317',
    occurred_at: '2026-09-16T20:21:00.000Z',
    received_at: '2026-09-16T20:22:00.000Z',
    raw_text: 'SELL XAUUSD ENTRY 4275 SL 4390 TP 4250',
    structured_payload: {},
    thread: { edited_event_id: '-100123:317' },
    metadata: { telegram_update_kind: 'edited_channel_post' },
    ...overrides,
  };
}

function supabaseMock({ insertResult, lookupResult } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ op: 'from', table });
      return {
        insert(row) {
          calls.push({ op: 'insert', table, row: structuredClone(row) });
          return {
            select(columns) {
              calls.push({ op: 'insert-select', table, columns });
              return { single: async () => structuredClone(insertResult) };
            },
          };
        },
        select(columns) {
          calls.push({ op: 'select', table, columns });
          const filters = [];
          const query = {
            eq(column, value) {
              filters.push([column, value]);
              calls.push({ op: 'eq', table, column, value });
              return query;
            },
            maybeSingle: async () => {
              calls.push({ op: 'maybeSingle', table, filters: structuredClone(filters) });
              return structuredClone(lookupResult);
            },
          };
          return query;
        },
        update(payload) {
          calls.push({ op: 'update', table, payload: structuredClone(payload) });
          return {
            eq: async (column, value) => {
              calls.push({ op: 'update-eq', table, column, value });
              return { data: null, error: null };
            },
          };
        },
      };
    },
  };
}

function stores(supabase) {
  return createSupabaseIngestStores(supabase, {
    masterKey: 'test-master-key',
    decryptFn: async () => 'unused',
  });
}

test('reserveRevision returns a new revision id after successful insert', async () => {
  const supabase = supabaseMock({ insertResult: { data: { id: 'rev-new' }, error: null } });
  const { eventStore } = stores(supabase);

  const result = await eventStore.reserveRevision(revisionRow());

  assert.deepEqual(result, { ok: true, duplicate: false, revisionId: 'rev-new' });
  const insert = supabase.calls.find((call) => call.op === 'insert');
  assert.equal(insert.table, 'trading_event_revisions');
  assert.equal(insert.row.trading_event_id, 'evt-1');
  assert.match(insert.row.revision_key, /^sha256:[a-f0-9]{64}$/);
});

test('reserveRevision recovers exact persisted revision and terminal interpretation after unique-key conflict', async () => {
  const canonicalIntent = {
    side: 'SELL',
    orderType: 'LIMIT',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 4275 },
    stopLoss: 4390,
    takeProfits: [4250],
    incomplete: false,
  };
  const supabase = supabaseMock({
    insertResult: { data: null, error: { code: '23505', message: 'duplicate key' } },
    lookupResult: {
      data: {
        id: 'rev-existing',
        ...revisionRow(),
        created_at: '2026-09-16T20:22:01.000Z',
        processing_status: 'READY',
        canonical_intent: canonicalIntent,
        error_code: null,
      },
      error: null,
    },
  });
  const { eventStore } = stores(supabase);

  const result = await eventStore.reserveRevision(revisionRow());

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.revisionId, 'rev-existing');
  assert.equal(result.event.external_event_id, '-100123:317');
  assert.equal(result.event.received_at, '2026-09-16T20:22:00.000Z');
  assert.equal(result.event.text, 'SELL XAUUSD ENTRY 4275 SL 4390 TP 4250');
  assert.deepEqual(result.interpretation, { status: 'READY', intent: canonicalIntent });

  const filters = supabase.calls.find((call) => call.op === 'maybeSingle')?.filters;
  assert.deepEqual(filters, [
    ['trading_event_id', 'evt-1'],
    ['revision_key', `sha256:${'a'.repeat(64)}`],
  ]);
});

test('updateRevisionInterpretation persists normalized terminal fields to the revision row', async () => {
  const supabase = supabaseMock();
  const { eventStore } = stores(supabase);
  const intent = { side: 'SELL', symbol: { canonical: 'XAUUSD' } };

  await eventStore.updateRevisionInterpretation('rev-1', { status: 'READY', intent });

  const update = supabase.calls.find((call) => call.op === 'update');
  assert.equal(update.table, 'trading_event_revisions');
  assert.deepEqual(update.payload, {
    processing_status: 'READY',
    canonical_intent: intent,
    error_code: null,
  });
  assert.ok(supabase.calls.some((call) => call.op === 'update-eq' && call.column === 'id' && call.value === 'rev-1'));
});

test('migration 0039 keeps revision history private while allowing service-role runtime persistence', async () => {
  const sql = await readFile(new URL('../db/migrations/0039_trading_event_revisions.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE public\.trading_event_revisions ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.trading_event_revisions FROM anon, authenticated/i);
  assert.match(sql, /GRANT ALL PRIVILEGES ON TABLE public\.trading_event_revisions TO service_role/i);
});
