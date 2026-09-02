import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrationUrl = new URL('../db/migrations/0009_trading_workspace_memberships.sql', import.meta.url);

test('membership migration creates a service-only workspace and subject boundary', () => {
  assert.equal(fs.existsSync(migrationUrl), true, 'migration 0009 must exist');
  const sql = fs.readFileSync(migrationUrl, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.trading_workspace_memberships/i);
  assert.match(sql, /workspace_id UUID NOT NULL REFERENCES public\.trading_workspace_access\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /zitadel_subject TEXT NOT NULL/i);
  assert.match(sql, /trading_role TEXT NOT NULL CHECK \(trading_role IN \('owner', 'admin', 'operator', 'viewer'\)\)/i);
  assert.match(sql, /membership_enabled BOOLEAN NOT NULL DEFAULT TRUE/i);
  assert.match(sql, /UNIQUE\s*\(workspace_id, zitadel_subject\)/i);
  assert.match(sql, /ALTER TABLE public\.trading_workspace_memberships ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.trading_workspace_memberships FROM anon/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.trading_workspace_memberships FROM authenticated/i);
  assert.match(sql, /GRANT ALL PRIVILEGES ON TABLE public\.trading_workspace_memberships TO service_role/i);
});
