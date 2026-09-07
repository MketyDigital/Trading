import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationUrl = new URL('../db/migrations/0010_tradingview_public_source_handle.sql', import.meta.url);

test('TradingView public handle migration is additive unique and Trading-owned only', () => {
  assert.equal(fs.existsSync(migrationUrl), true, 'migration 0010 must exist');
  const sql = fs.readFileSync(migrationUrl, 'utf8');

  assert.match(sql, /ALTER TABLE public\.source_connections[\s\S]*ADD COLUMN IF NOT EXISTS public_source_handle TEXT/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_public_source_handle[\s\S]*ON public\.source_connections\s*\(public_source_handle\)[\s\S]*WHERE public_source_handle IS NOT NULL/i);

  assert.doesNotMatch(sql, /ALTER TABLE public\.workspaces\b/i);
  assert.doesNotMatch(sql, /ALTER TABLE public\.(?:users|campaigns|blogs|leads|chats|packages)\b/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.source_connections/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.source_connections/i);
});
