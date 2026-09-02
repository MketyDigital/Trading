import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationUrl = new URL('../db/migrations/0010_tradingview_webhook_handle.sql', import.meta.url);

test('TradingView webhook handle migration adds one non-secret unique routing handle', () => {
  assert.equal(fs.existsSync(migrationUrl), true, 'migration 0010 must exist');
  const sql = fs.readFileSync(migrationUrl, 'utf8');

  assert.match(sql, /ALTER TABLE public\.source_connections/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS webhook_handle TEXT/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_webhook_handle_unique/i);
  assert.match(sql, /ON public\.source_connections\(webhook_handle\)/i);
  assert.match(sql, /WHERE webhook_handle IS NOT NULL/i);
  assert.doesNotMatch(sql, /secret|password|token/i);
});
