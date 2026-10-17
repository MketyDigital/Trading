import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const columnsSnapshot = JSON.parse(readFileSync(resolve(root, 'docs/supabase-trading-schema-snapshot-2026-10-17.json'), 'utf8'));
const schemaSnapshot = JSON.parse(readFileSync(resolve(root, 'docs/supabase-trading-constraints-snapshot-2026-10-17.json'), 'utf8'));
const definitions = new Map(schemaSnapshot.tables.map(table => [table.table, table]));
const tables = columnsSnapshot.tables.filter(table => table.name !== 'trading_runtime_controls');

function ident(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function pgDefault(column) {
  return column.default?.replace(/^extensions\.uuid_generate_v4\(\)$/, 'gen_random_uuid()') ?? null;
}

function d1Default(column) {
  let value = column.default;
  if (!value || /(?:uuid_generate_v4|gen_random_uuid)\(\)/i.test(value)) return null;
  value = value.replace(/::(?:jsonb|text|numeric|integer|boolean|text\[\])/g, '');
  if (column.type === 'boolean') value = value.replace(/^true$/i, '1').replace(/^false$/i, '0');
  if (column.type === 'ARRAY') value = "'[]'";
  if (/^now\(\)$/i.test(value)) return 'CURRENT_TIMESTAMP';
  return value;
}

function d1Type(column) {
  if (column.type === 'uuid') return 'TEXT';
  if (column.type === 'boolean') return 'INTEGER';
  if (column.type === 'ARRAY' || column.type === 'jsonb') return 'TEXT';
  if (column.type === 'numeric') return 'TEXT';
  if (column.type === 'timestamp with time zone') return 'TEXT';
  if (column.type === 'bigint' || column.type === 'integer') return 'INTEGER';
  if (column.type === 'text') return 'TEXT';
  throw new Error(`Unsupported D1 type ${column.type} on ${column.name}`);
}

function pgType(column) {
  if (column.type === 'ARRAY') return 'text[]';
  return column.type;
}

function convertD1Check(definition) {
  let sql = definition.replace(/^CHECK\s*\((.*)\)$/is, '$1').replace(/::(?:text|numeric|integer|boolean|jsonb)/g, '');
  sql = sql.replace(/([a-z_][a-z0-9_]*)\s*=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]\s*\)/gi, '$1 IN ($2)');
  sql = sql.replace(/([a-z_][a-z0-9_]*)\s*!~\s*'\\\.\$'/gi, "substr($1, -1, 1) <> '.'");
  sql = sql.replace(/\bbtrim\s*\(/gi, 'trim(');
  sql = sql.replace(/\blots\s*>=\s*0\b/gi, 'CAST(lots AS REAL) >= 0');
  if (/ANY\s*\(|!~|::|NOT VALID/i.test(sql)) throw new Error(`D1 check needs a reviewed conversion: ${definition}`);
  return `CHECK (${sql})`;
}

function foreignKey(definition, dialect) {
  const match = definition.match(/^FOREIGN KEY \(([^)]+)\) REFERENCES (?:public\.)?([a-z_][a-z0-9_]*)\(([^)]+)\)(?: ON DELETE ([\s\S]+))?$/i);
  if (!match) throw new Error(`Unparsed foreign key: ${definition}`);
  let action = (match[4] || 'NO ACTION').replace(/\s+/g, ' ').trim();
  const partialSetNull = /^SET NULL \(([^)]+)\)$/i.test(action);
  if (partialSetNull && dialect === 'd1') action = 'RESTRICT';
  const target = dialect === 'postgres' ? `trading_storage.${ident(match[2])}` : ident(match[2]);
  return `FOREIGN KEY (${match[1]}) REFERENCES ${target} (${match[3]}) ON DELETE ${action}`;
}

function constraintsFor(table, dialect) {
  const metadata = definitions.get(table.name);
  if (!metadata) throw new Error(`Missing live constraint metadata for ${table.name}`);
  return (metadata.constraints || []).flatMap(constraint => {
    // The raw token is deliberately absent in the target schema; uniqueness moves to its keyed hash.
    if (table.name === 'workspaces' && /UNIQUE\s*\(\s*tg_bot_token\s*\)/i.test(constraint.definition)) return [];
    if (constraint.type === 'p') return [`PRIMARY KEY ${constraint.definition.match(/PRIMARY KEY\s*(\([^)]*\))/i)?.[1]}`];
    if (constraint.type === 'u') return [`UNIQUE ${constraint.definition.match(/UNIQUE\s*(\([^)]*\))/i)?.[1]}`];
    if (constraint.type === 'c') {
      if (dialect === 'd1' && constraint.name === 'trade_accounts_environment_check') return [];
      const definition = constraint.definition.replace(/\s+NOT VALID$/i, '');
      const check = dialect === 'd1' ? convertD1Check(definition) : definition;
      return [check];
    }
    if (constraint.type === 'f') return [foreignKey(constraint.definition, dialect)];
    throw new Error(`Unknown constraint type ${constraint.type} on ${table.name}`);
  });
}

function targetColumns(table, dialect) {
  const columns = table.columns.flatMap(column => {
    if (table.name === 'workspaces' && column.name === 'tg_bot_token') return [];
    if (table.name === 'ai_providers' && column.name === 'api_key') return [];
    const type = dialect === 'd1' ? d1Type(column) : pgType(column);
    const parts = [ident(column.name), type];
    const defaultValue = dialect === 'd1' ? d1Default(column) : pgDefault(column);
    if (defaultValue !== null) parts.push('DEFAULT', defaultValue);
    if (!column.nullable) parts.push('NOT NULL');
    if (dialect === 'd1' && ['jsonb', 'ARRAY'].includes(column.type)) parts.push(`CHECK (json_valid(${ident(column.name)}))`);
    return [parts.join(' ')];
  });
  if (table.name === 'workspaces') {
    columns.push('"tg_bot_token_ciphertext" TEXT');
    columns.push('"tg_bot_token_hash" TEXT');
  }
  if (dialect === 'd1') {
    columns.push(...constraintsFor(table, dialect));
    return columns;
  }
  columns.push(...constraintsFor(table, dialect));
  return columns;
}

function orderTables() {
  const pending = new Map(tables.map(table => [table.name, table]));
  const ordered = [];
  while (pending.size) {
    let progress = false;
    for (const [name, table] of pending) {
      const refs = (definitions.get(name)?.constraints || [])
        .filter(constraint => constraint.type === 'f')
        .map(constraint => constraint.definition.match(/REFERENCES (?:public\.)?([a-z_][a-z0-9_]*)/i)?.[1])
        .filter(target => target && pending.has(target) && target !== name);
      if (refs.length) continue;
      ordered.push(table);
      pending.delete(name);
      progress = true;
    }
    if (!progress) throw new Error(`Cyclic schema dependencies remain: ${[...pending.keys()].join(', ')}`);
  }
  return ordered;
}

function indexesFor(table, dialect) {
  const constraints = new Set((definitions.get(table.name)?.constraints || [])
    .filter(constraint => constraint.type === 'p' || constraint.type === 'u')
    .map(constraint => constraint.name));
  return (definitions.get(table.name)?.indexes || []).flatMap(definition => {
    const name = definition.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+([^\s]+)/i)?.[1];
    if (!name || name.endsWith('_pkey') || constraints.has(name)) return [];
    let sql = definition.replace(/ USING btree/g, '').replace(/public\./g, dialect === 'postgres' ? 'trading_storage.' : '');
    if (dialect === 'd1') {
      sql = sql.replace(/::(?:text|numeric|integer|boolean|jsonb)/g, '');
      sql = sql.replace(/([a-z_][a-z0-9_]*)\s*=\s*ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]\s*\)/gi, '$1 IN ($2)');
    }
    if (dialect === 'postgres') sql = sql.replace(/^CREATE (UNIQUE )?INDEX /i, 'CREATE $1INDEX IF NOT EXISTS ');
    if (dialect === 'd1') sql = sql.replace(/^CREATE (UNIQUE )?INDEX /i, 'CREATE $1INDEX IF NOT EXISTS ');
    if (dialect === 'd1' && /ANY\s*\(|::/.test(sql)) throw new Error(`D1 index needs a reviewed conversion: ${definition}`);
    return [`${sql};`];
  });
}

const ordered = orderTables();
const postgres = [
  '-- Dedicated Trading schema generated from the read-only 2026-10-17 production metadata snapshot.',
  '-- Secrets are stored only as ciphertext; legacy plaintext credential columns are intentionally omitted.',
  'CREATE SCHEMA IF NOT EXISTS trading_storage;',
];
for (const table of ordered) {
  postgres.push(`CREATE TABLE IF NOT EXISTS trading_storage.${ident(table.name)} (\n  ${targetColumns(table, 'postgres').join(',\n  ')}\n);`);
}
for (const table of ordered) postgres.push(...indexesFor(table, 'postgres'));

const d1 = [
  '-- Dedicated Trading domain schema generated from the read-only 2026-10-17 production metadata snapshot.',
  '-- SQLite affinity differences are intentional: UUID/time values are TEXT, booleans INTEGER, JSON/arrays validated TEXT, numerics TEXT.',
  '-- Application repositories must generate UUIDs and enforce trade_accounts connected-DEMO policy before writes.',
];
for (const table of ordered) {
  d1.push(`CREATE TABLE IF NOT EXISTS ${ident(table.name)} (\n  ${targetColumns(table, 'd1').join(',\n  ')}\n);`);
}
for (const table of ordered) d1.push(...indexesFor(table, 'd1'));
d1.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_tg_bot_token_hash ON workspaces(tg_bot_token_hash) WHERE tg_bot_token_hash IS NOT NULL;`);
postgres.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_tg_bot_token_hash ON trading_storage."workspaces"("tg_bot_token_hash") WHERE "tg_bot_token_hash" IS NOT NULL;`);
d1.push(`CREATE TRIGGER IF NOT EXISTS trading_destination_template_set_null_before_delete BEFORE DELETE ON trading_destination_templates
BEGIN
  UPDATE trading_destinations SET template_id = NULL
   WHERE workspace_id = OLD.workspace_id AND template_id = OLD.id;
END;`);
d1.push(`CREATE TRIGGER IF NOT EXISTS trading_access_code_workspace_lock AFTER UPDATE OF status ON trading_access_codes
WHEN NEW.product = 'trading' AND NEW.status <> 'active' AND OLD.status = 'active'
BEGIN
  UPDATE trading_workspace_access
     SET trading_access_enabled = 0,
         metadata = json_set(COALESCE(metadata, '{}'), '$.accessLockedAt', CURRENT_TIMESTAMP, '$.accessLockReason', 'revoked'),
         updated_at = CURRENT_TIMESTAMP
   WHERE id = NEW.workspace_id
     AND json_extract(metadata, '$.accessCodeId') = NEW.id;
END;`);

function qualifiedFunction(definition, schemaName, functionName) {
  let result = definition
    .replace(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${functionName}`, 'i'), `CREATE OR REPLACE FUNCTION ${schemaName}.${functionName}`)
    .replace(/public\./g, `${schemaName}.`)
    .replace(/SET search_path TO 'public'/i, `SET search_path TO ''`);
  if (!/RETURNS\s+trigger/i.test(result)) result = result.replace(/RETURNS ([a-z_][a-z0-9_]*)/i, `RETURNS ${schemaName}.$1`);
  return result;
}
const tradeAccount = definitions.get('trade_accounts').triggers?.[0]?.function;
const accessCode = definitions.get('trading_access_codes').triggers?.[0]?.function;
if (!tradeAccount || !accessCode) throw new Error('Live trigger function source is missing');
d1.push(`CREATE TRIGGER IF NOT EXISTS trg_enforce_connected_demo_execution_insert AFTER INSERT ON trade_accounts
WHEN lower(COALESCE(NEW.environment, '')) = 'demo'
  AND NULLIF(trim(COALESCE(NEW.account_id, '')), '') IS NOT NULL
  AND lower(COALESCE(NEW.account_id, '')) NOT LIKE 'pending:%'
  AND (lower(COALESCE(NEW.provider_mode, '')) NOT IN ('mt5_connector', 'ctrader_cbot')
       OR lower(COALESCE(json_extract(NEW.provider_config, '$.status'), '')) = 'connected')
BEGIN
  UPDATE trade_accounts
     SET is_active = 1,
         live_execution_enabled = 0,
         execution_enabled = CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 1 ELSE 0 END,
         safety_policy = json_set(COALESCE(NEW.safety_policy, '{}'), '$.killSwitch', json(CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 'false' ELSE 'true' END))
   WHERE id = NEW.id;
END;`);
d1.push(`CREATE TRIGGER IF NOT EXISTS trg_enforce_connected_demo_execution_update AFTER UPDATE ON trade_accounts
WHEN lower(COALESCE(NEW.environment, '')) = 'demo'
  AND NULLIF(trim(COALESCE(NEW.account_id, '')), '') IS NOT NULL
  AND lower(COALESCE(NEW.account_id, '')) NOT LIKE 'pending:%'
  AND (lower(COALESCE(NEW.provider_mode, '')) NOT IN ('mt5_connector', 'ctrader_cbot')
       OR lower(COALESCE(json_extract(NEW.provider_config, '$.status'), '')) = 'connected')
  AND (NEW.is_active IS NOT 1 OR NEW.live_execution_enabled IS NOT 0
       OR NEW.execution_enabled IS NOT CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 1 ELSE 0 END
       OR json_extract(NEW.safety_policy, '$.killSwitch') IS NOT CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 0 ELSE 1 END)
BEGIN
  UPDATE trade_accounts
     SET is_active = 1,
         live_execution_enabled = 0,
         execution_enabled = CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 1 ELSE 0 END,
         safety_policy = json_set(COALESCE(NEW.safety_policy, '{}'), '$.killSwitch', json(CASE WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(NEW.roles, '[]')) WHERE value = 'execution') THEN 'false' ELSE 'true' END))
   WHERE id = NEW.id;
END;`);
postgres.push(qualifiedFunction(tradeAccount, 'trading_storage', 'enforce_connected_demo_execution'));
postgres.push(`CREATE TRIGGER trg_enforce_connected_demo_execution BEFORE INSERT OR UPDATE ON trading_storage.trade_accounts FOR EACH ROW EXECUTE FUNCTION trading_storage.enforce_connected_demo_execution();`);
postgres.push(qualifiedFunction(accessCode, 'trading_storage', 'sync_trading_workspace_access_code_status'));
postgres.push(`CREATE TRIGGER trading_access_code_workspace_lock AFTER UPDATE OF status ON trading_storage.trading_access_codes FOR EACH ROW EXECUTE FUNCTION trading_storage.sync_trading_workspace_access_code_status();`);
for (const rpc of schemaSnapshot.rpcs) {
  const def = qualifiedFunction(rpc.definition, 'trading_storage', rpc.name);
  postgres.push(def);
  if (rpc.securityDefiner) {
    const signature = rpc.name === 'rotate_trading_access_code'
      ? 'uuid, text, text, text, text, jsonb, integer, timestamptz, jsonb'
      : 'uuid, text, uuid';
    postgres.push(`REVOKE ALL ON FUNCTION trading_storage.${rpc.name}(${signature}) FROM PUBLIC;`);
  }
}
postgres.push('-- Grant EXECUTE on these functions only to the dedicated Trading Worker role when that role is provisioned.');
postgres.push('-- Supabase catalog confirms both RPCs are executable by service_role only; anon, authenticated, and PUBLIC are denied.');

writeFileSync(resolve(root, 'cloudflare-v2/db/d1-migrations/0002_trading_domain_schema.sql'), `${d1.join('\n\n')}\n`);
writeFileSync(resolve(root, 'cloudflare-v2/db/postgres-migrations/0002_trading_domain_schema.sql'), `${postgres.join('\n\n')}\n`);
console.log(`Generated D1 and PostgreSQL schemas for ${ordered.length} relations plus one shared runtime-control relation.`);
