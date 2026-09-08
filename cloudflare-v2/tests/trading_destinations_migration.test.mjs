import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../db/migrations/0015_trading_destinations_templates_routes.sql');

test('migration 0015 enforces workspace isolation across templates, destinations, sources, and routes', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /UNIQUE\s*\(workspace_id,\s*id\)/i);
  assert.match(sql, /FOREIGN KEY\s*\(workspace_id,\s*template_id\)\s*REFERENCES public\.trading_destination_templates\s*\(workspace_id,\s*id\)/i);
  assert.match(sql, /FOREIGN KEY\s*\(workspace_id,\s*source_connection_id\)\s*REFERENCES public\.source_connections\s*\(workspace_id,\s*id\)/i);
  assert.match(sql, /FOREIGN KEY\s*\(workspace_id,\s*destination_id\)\s*REFERENCES public\.trading_destinations\s*\(workspace_id,\s*id\)/i);
});

test('migration 0015 keeps new destination configuration tables service-role only', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  for (const table of ['trading_destination_templates', 'trading_destinations', 'source_destination_routes']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\.${table} FROM anon`, 'i'));
    assert.match(sql, new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\.${table} FROM authenticated`, 'i'));
    assert.match(sql, new RegExp(`GRANT ALL PRIVILEGES ON TABLE public\\.${table} TO service_role`, 'i'));
  }
});
