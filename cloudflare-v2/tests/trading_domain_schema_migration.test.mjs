import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const migration1 = readFileSync(new URL('../db/d1-migrations/0001_trading_storage_replication.sql', here), 'utf8');
const migration2 = readFileSync(new URL('../db/d1-migrations/0002_trading_domain_schema.sql', here), 'utf8');

test('D1 domain migration creates every production Trading relation and all observed indexes', () => {
  const metadata = JSON.parse(readFileSync(new URL('../../docs/supabase-trading-constraints-snapshot-2026-10-17.json', here), 'utf8'));
  const columns = JSON.parse(readFileSync(new URL('../../docs/supabase-trading-schema-snapshot-2026-10-17.json', here), 'utf8'));
  const db = new DatabaseSync(':memory:');
  db.exec(migration1);
  db.exec(migration2);
  const relations = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(row => row.name));
  for (const { name } of columns.tables) assert.ok(relations.has(name), `missing D1 table ${name}`);
  for (const table of columns.tables) {
    const actual = new Set(db.prepare(`PRAGMA table_info("${table.name}")`).all().map(row => row.name));
    for (const column of table.columns) {
      if ((table.name === 'workspaces' && column.name === 'tg_bot_token') || (table.name === 'ai_providers' && column.name === 'api_key')) continue;
      assert.ok(actual.has(column.name), `missing D1 column ${table.name}.${column.name}`);
    }
  }
  const indexes = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all().map(row => row.name));
  for (const table of metadata.tables) {
    for (const index of table.indexes || []) {
      const name = index.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)/i)?.[1];
      if (!name || name.endsWith('_pkey') || table.constraints?.some(c => (c.type === 'u' || c.type === 'p') && c.name === name)) continue;
      assert.ok(indexes.has(name), `missing D1 index ${name}`);
    }
  }
  db.close();
});

test('D1 domain schema stores credential fields only as ciphertext and safe hashes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration1);
  db.exec(migration2);
  const workspaceColumns = db.prepare(`PRAGMA table_info(workspaces)`).all().map(row => row.name);
  const providerColumns = db.prepare(`PRAGMA table_info(ai_providers)`).all().map(row => row.name);
  assert.ok(workspaceColumns.includes('tg_bot_token_ciphertext'));
  assert.ok(workspaceColumns.includes('tg_bot_token_hash'));
  assert.ok(!workspaceColumns.includes('tg_bot_token'));
  assert.ok(!providerColumns.includes('api_key'));
  assert.ok(providerColumns.includes('api_key_ciphertext'));
  db.close();
});

test('D1 access-code revocation locks only the workspace provisioned by that code', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration1);
  db.exec(migration2);
  db.prepare(`INSERT INTO trading_workspace_access(id, trading_access_enabled, metadata) VALUES (?, 1, ?)`)
    .run('ws-1', JSON.stringify({ accessCodeId: 'code-1' }));
  db.prepare(`INSERT INTO trading_workspace_access(id, trading_access_enabled, metadata) VALUES (?, 1, ?)`)
    .run('ws-2', JSON.stringify({ accessCodeId: 'other-code' }));
  db.prepare(`INSERT INTO trading_access_codes(id, code_hash, workspace_id, metadata) VALUES (?, ?, ?, ?)`)
    .run('code-1', 'hash-1', 'ws-1', '{}');
  db.prepare(`UPDATE trading_access_codes SET status='revoked' WHERE id='code-1'`).run();
  const result = db.prepare(`SELECT id, trading_access_enabled, metadata FROM trading_workspace_access ORDER BY id`).all();
  assert.equal(result[0].trading_access_enabled, 0);
  assert.equal(JSON.parse(result[0].metadata).accessLockReason, 'revoked');
  assert.equal(result[1].trading_access_enabled, 1);
  db.close();
});

test('D1 template deletion preserves PostgreSQL composite SET NULL behavior', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration1);
  db.exec(migration2);
  db.prepare(`INSERT INTO trading_workspace_access(id) VALUES (?)`).run('ws');
  db.prepare(`INSERT INTO trading_destination_templates(id, workspace_id, template_name) VALUES (?, ?, ?)`).run('template', 'ws', 'Default');
  db.prepare(`INSERT INTO trading_destinations(id, workspace_id, destination_type, display_name, template_id) VALUES (?, ?, ?, ?, ?)`).run('dest', 'ws', 'telegram', 'VIP', 'template');
  db.prepare(`DELETE FROM trading_destination_templates WHERE id = ?`).run('template');
  assert.equal(db.prepare(`SELECT template_id FROM trading_destinations WHERE id = 'dest'`).get().template_id, null);
  db.close();
});

test('D1 connected DEMO trigger matches the PostgreSQL safety promotion rules', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration1); db.exec(migration2);
  db.prepare(`INSERT INTO trading_workspace_access(id) VALUES ('ws')`).run();
  db.prepare(`INSERT INTO trade_accounts(id,workspace_id,account_label,platform,account_id,environment,provider_mode,roles,is_active,execution_enabled,live_execution_enabled,safety_policy) VALUES ('demo','ws','Demo','mt5','123','DEMO','legacy','["execution"]',0,0,1,'{"killSwitch":true}')`).run();
  let row = db.prepare(`SELECT is_active,execution_enabled,live_execution_enabled,safety_policy FROM trade_accounts WHERE id='demo'`).get();
  assert.equal(row.is_active, 1); assert.equal(row.execution_enabled, 1); assert.equal(row.live_execution_enabled, 0); assert.equal(JSON.parse(row.safety_policy).killSwitch, false);

  db.prepare(`INSERT INTO trade_accounts(id,workspace_id,account_label,platform,account_id,environment,provider_mode,provider_config,roles,is_active,execution_enabled,live_execution_enabled,safety_policy) VALUES ('connector','ws','Connector','mt5','123','DEMO','mt5_connector','{"status":"disconnected"}','["execution"]',0,0,1,'{"killSwitch":true}')`).run();
  row = db.prepare(`SELECT is_active,execution_enabled,live_execution_enabled,safety_policy FROM trade_accounts WHERE id='connector'`).get();
  assert.equal(row.is_active, 0); assert.equal(row.execution_enabled, 0); assert.equal(row.live_execution_enabled, 1); assert.equal(JSON.parse(row.safety_policy).killSwitch, true);
  db.prepare(`UPDATE trade_accounts SET provider_config='{"status":"connected"}' WHERE id='connector'`).run();
  row = db.prepare(`SELECT is_active,execution_enabled,live_execution_enabled,safety_policy FROM trade_accounts WHERE id='connector'`).get();
  assert.equal(row.is_active, 1); assert.equal(row.execution_enabled, 1); assert.equal(row.live_execution_enabled, 0); assert.equal(JSON.parse(row.safety_policy).killSwitch, false);
  db.close();
});
