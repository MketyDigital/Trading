import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createOperationJournalStore,
  normalizeOperationEvidence,
} from '../src/operations/operation_journal.js';

test('normalizes operation evidence to a bounded secret-safe taxonomy', () => {
  const evidence = normalizeOperationEvidence({
    workspaceId: 'ws-1',
    evidenceKey: 'event-1:ai:provider-1:attempt-1',
    correlationId: 'corr-1',
    tradingEventId: 'event-1',
    aiProviderId: 'provider-1',
    stage: 'ai_provider',
    operation: 'interpret',
    status: 'failed',
    errorCode: 'invalid_api_key',
    failureClass: 'AUTH',
    retryable: false,
    summary: 'AI provider request failed.',
    details: {
      httpStatus: 401,
      providerType: 'openai',
      model: 'gpt-test',
      api_key: 'sk-never-persist',
      authorization: 'Bearer never-persist',
      nested: { password: 'never-persist', safe: 'kept' },
      stack: 'internal stack must not persist',
      raw_body: 'raw provider body must not persist',
    },
    observedAt: '2026-09-16T23:10:00.000Z',
  });

  assert.equal(evidence.stage, 'AI_PROVIDER');
  assert.equal(evidence.status, 'FAILED');
  assert.equal(evidence.operation, 'interpret');
  assert.equal(evidence.workspaceId, 'ws-1');
  assert.equal(evidence.correlationId, 'corr-1');
  assert.equal(evidence.details.httpStatus, 401);
  assert.equal(evidence.details.providerType, 'openai');
  assert.equal(evidence.details.model, 'gpt-test');
  assert.equal(evidence.details.api_key, '[REDACTED]');
  assert.equal(evidence.details.authorization, '[REDACTED]');
  assert.equal(evidence.details.nested.password, '[REDACTED]');
  assert.equal(evidence.details.nested.safe, 'kept');
  assert.equal(Object.hasOwn(evidence.details, 'stack'), false);
  assert.equal(Object.hasOwn(evidence.details, 'raw_body'), false);
  assert.equal(JSON.stringify(evidence).includes('sk-never-persist'), false);
  assert.equal(JSON.stringify(evidence).includes('Bearer never-persist'), false);
});

test('rejects unknown stage/status rather than creating free-form journal semantics', () => {
  assert.throws(() => normalizeOperationEvidence({
    workspaceId: 'ws-1',
    evidenceKey: 'bad-stage',
    correlationId: 'corr-1',
    stage: 'random_internal_thing',
    operation: 'x',
    status: 'SUCCEEDED',
  }), /OPERATION_STAGE_INVALID/);

  assert.throws(() => normalizeOperationEvidence({
    workspaceId: 'ws-1',
    evidenceKey: 'bad-status',
    correlationId: 'corr-1',
    stage: 'INGRESS',
    operation: 'x',
    status: 'MAYBE',
  }), /OPERATION_STATUS_INVALID/);
});

test('journal store is append-only/idempotent by workspace + evidence key and never updates existing evidence', async () => {
  const rows = [];
  const supabase = {
    from(table) {
      assert.equal(table, 'operation_journal');
      return {
        async upsert(row, options) {
          assert.deepEqual(options, {
            onConflict: 'workspace_id,evidence_key',
            ignoreDuplicates: true,
          });
          if (!rows.some((item) => item.workspace_id === row.workspace_id && item.evidence_key === row.evidence_key)) {
            rows.push(structuredClone(row));
          }
          return { error: null };
        },
      };
    },
  };
  const store = createOperationJournalStore(supabase, { nowFn: () => new Date('2026-09-16T23:11:00.000Z') });

  const base = {
    workspaceId: 'ws-1',
    evidenceKey: 'event-1:ingress:accepted',
    correlationId: 'corr-1',
    stage: 'INGRESS',
    operation: 'source_event_received',
    status: 'SUCCEEDED',
    summary: 'Source event accepted.',
  };
  await store.append(base);
  await store.append({ ...base, summary: 'A replay must not rewrite existing evidence.' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].summary, 'Source event accepted.');
  assert.equal(rows[0].observed_at, '2026-09-16T23:11:00.000Z');
});

test('migration 0042 creates indexed workspace-scoped operation evidence without replacing execution authority', async () => {
  const sql = await readFile(new URL('../db/migrations/0042_operation_journal.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.operation_journal/i);
  assert.match(sql, /evidence_key\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /correlation_id\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /stage\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /status\s+TEXT\s+NOT NULL/i);
  assert.match(sql, /details\s+JSONB/i);
  assert.match(sql, /UNIQUE\s*\(workspace_id,\s*evidence_key\)/i);
  assert.match(sql, /operation_journal_workspace_time_idx/i);
  assert.match(sql, /operation_journal_event_time_idx/i);
  assert.match(sql, /operation_journal_correlation_time_idx/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.equal(/destination_deliveries\s+DROP/i.test(sql), false);
  assert.equal(/position_groups\s+DROP/i.test(sql), false);
});
