import { createHash, createHmac, randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve, sep } from 'node:path';
import { encryptSecret, decryptSecret } from '../src/security/secret_box.js';
import { sanitizeAccountSymbolCatalog } from '../src/execution/account_symbol_catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(here, '../..');
const SNAPSHOT_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'docs/supabase-trading-schema-snapshot-2026-10-17.json');
const EXPECTED_PROJECT_REF = 'vdblajgxrfndjesoyayy';
const FORMAT = 'mkety-trading-data-snapshot-v2';
export const TRADING_CONTINUITY_PROFILE = 'continuity-fresh-start';
export const TRADING_CONTINUITY_TABLES = Object.freeze([
  'workspaces', 'trading_workspace_access', 'trading_workspace_memberships',
  'trading_access_codes', 'trading_access_code_redemptions', 'trading_runtime_controls',
  'source_connections', 'source_feeds', 'source_destination_routes', 'signal_routes',
  'trading_destinations', 'trading_destination_templates', 'trading_destination_connections',
  'ai_providers', 'trade_accounts', 'trading_workspace_hostnames', 'trading_ingress_collectors',
  'vip_members', 'bank_deposits', 'orphan_signal_recovery_cursors',
]);
export const TRADING_CONTINUITY_TABLE_COUNT = TRADING_CONTINUITY_TABLES.length;
const CONTINUITY_TABLE_SET = new Set(TRADING_CONTINUITY_TABLES);
const MAX_LIVE_CUTOVER_DRIFT_PER_TABLE = 2_000;
const MAX_LIVE_CUTOVER_DRIFT_TOTAL = 10_000;
const CUTOVER_REFRESH_TABLES = new Set([
  'workspaces', 'trading_workspace_access', 'trading_workspace_memberships',
  'trading_access_codes', 'trading_access_code_redemptions', 'trading_runtime_controls',
  'source_connections', 'source_feeds', 'source_destination_routes', 'signal_routes',
  'trading_destinations', 'trading_destination_templates', 'trading_destination_connections',
  'ai_providers', 'trade_accounts', 'orphan_signal_recovery_cursors',
  'trading_workspace_hostnames', 'trading_ingress_collectors',
]);

function safeProjectRef(value) {
  const ref = String(value || '').trim();
  if (ref !== EXPECTED_PROJECT_REF) throw new Error('Snapshot source is not the expected Supabase project');
  return ref;
}

export function validateTradingSnapshotRequest({ cutoverReference, sourceProjectRef, pageSize = 500, profile = TRADING_CONTINUITY_PROFILE } = {}) {
  if (!/^source-cutover:[A-Z0-9][A-Z0-9-]{5,79}$/.test(String(cutoverReference || ''))) {
    throw new Error('An auditable source-cutover reference is required');
  }
  const projectRef = safeProjectRef(sourceProjectRef);
  if (profile !== TRADING_CONTINUITY_PROFILE) throw new Error('Only the reviewed continuity fresh-start snapshot profile is supported');
  const size = Number(pageSize);
  if (!Number.isSafeInteger(size) || size < 1 || size > 500) throw new Error('Snapshot page size must be between 1 and 500');
  return { cutoverReference: String(cutoverReference), sourceProjectRef: projectRef, pageSize: size, profile };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function rowKey(row, primaryKeys) {
  return primaryKeys.map((key) => {
    if (row[key] === undefined || row[key] === null) throw new Error('Snapshot row has a missing primary key');
    return String(row[key]);
  });
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

async function hashSecret(value) {
  return digest(String(value));
}

function keyedDigest(value, key) {
  if (!key) throw new Error('TRADING_MASTER_KEY is required for snapshot checksums');
  return createHmac('sha256', String(key)).update(typeof value === 'string' ? value : stable(value)).digest('hex');
}

async function migrateWorkspaceCredential(row, { encryptFn, decryptFn, hashFn, masterKey }) {
  const next = { ...row };
  const plaintext = next.tg_bot_token;
  delete next.tg_bot_token;
  if (plaintext == null || plaintext === '') {
    next.tg_bot_token_ciphertext = next.tg_bot_token_ciphertext || null;
    next.tg_bot_token_hash = next.tg_bot_token_hash || null;
    return next;
  }
  if (typeof plaintext !== 'string') throw new Error('Workspace bot token has an unsupported type');
  if (next.tg_bot_token_ciphertext) {
    const existingPlaintext = await decryptFn(next.tg_bot_token_ciphertext, masterKey);
    if (existingPlaintext !== plaintext) throw new Error('Workspace bot token plaintext and ciphertext disagree');
  } else {
    next.tg_bot_token_ciphertext = await encryptFn(plaintext, masterKey);
  }
  const tokenHash = await hashFn(plaintext);
  if (next.tg_bot_token_hash && next.tg_bot_token_hash !== tokenHash) throw new Error('Workspace bot token hash does not match its value');
  next.tg_bot_token_hash = tokenHash;
  return next;
}

async function migrateAIProviderCredential(row, { encryptFn, decryptFn, masterKey }) {
  const next = { ...row };
  const plaintext = next.api_key;
  delete next.api_key;
  if (plaintext == null || plaintext === '') {
    if (!('api_key_ciphertext' in next)) next.api_key_ciphertext = null;
    return next;
  }
  if (typeof plaintext !== 'string') throw new Error('AI provider API key has an unsupported type');
  if (next.api_key_ciphertext) {
    const existingPlaintext = await decryptFn(next.api_key_ciphertext, masterKey);
    if (existingPlaintext !== plaintext) throw new Error('AI provider plaintext and ciphertext credentials disagree');
  } else {
    next.api_key_ciphertext = await encryptFn(plaintext, masterKey);
  }
  return next;
}

export async function prepareTradingSnapshotRows(rowsByTable, {
  masterKey,
  encryptFn = encryptSecret,
  decryptFn = decryptSecret,
  hashFn = hashSecret
} = {}) {
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required to prepare a migration snapshot');
  const output = {};
  for (const [table, rows] of Object.entries(rowsByTable || {})) {
    if (!Array.isArray(rows)) throw new Error(`Snapshot table ${table} did not return rows`);
    output[table] = [];
    for (const row of rows) {
      let next = { ...row };
      if (table === 'workspaces') next = await migrateWorkspaceCredential(next, { encryptFn, decryptFn, hashFn, masterKey });
      if (table === 'ai_providers') next = await migrateAIProviderCredential(next, { encryptFn, decryptFn, masterKey });
      if (Object.hasOwn(next, 'tg_bot_token') || Object.hasOwn(next, 'api_key')) {
        throw new Error(`Plaintext credential remains in snapshot table ${table}`);
      }
      output[table].push(next);
    }
  }
  return output;
}

/** Preserve owner access and imported state while fencing broker execution on the target. */
export function prepareTradingSnapshotForImport(rowsByTable, { target, now = new Date().toISOString() } = {}) {
  if (!['d1', 'postgres'].includes(target)) throw new Error('Snapshot import target must be d1 or postgres');
  if (!rowsByTable || typeof rowsByTable !== 'object' || Array.isArray(rowsByTable)) {
    throw new Error('Trading snapshot rows are invalid');
  }
  for (const [table, rows] of Object.entries(rowsByTable)) {
    if (!Array.isArray(rows)) throw new Error(`Snapshot table ${table} did not return rows`);
  }
  const output = Object.fromEntries(Object.entries(rowsByTable).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]));
  const catalogNormalization = { accountsChanged: 0, catalogsChanged: 0, beforeBytes: 0, afterBytes: 0, bytesSaved: 0 };

  const requiredControls = new Set(['trading_access_enabled', 'broker_execution_enabled', 'live_broker_execution_enabled']);
  const controls = output.trading_runtime_controls;
  if (!Array.isArray(controls) || controls.length !== requiredControls.size
    || controls.some((row) => !requiredControls.delete(String(row.control_key))) || requiredControls.size) {
    throw new Error('Snapshot must contain each supported runtime control exactly once');
  }
  let globalControlsFenced = 0;
  for (const row of controls) {
    if (row.control_key === 'trading_access_enabled') continue;
    row.enabled = target === 'd1' ? 0 : false;
    row.updated_by = 'migration-import-fenced';
    row.updated_at = now;
    globalControlsFenced += 1;
  }

  const accounts = output.trade_accounts;
  if (!Array.isArray(accounts)) throw new Error('Snapshot trade_accounts table is missing');
  let accountsExecutionFenced = 0;
  let demoExecutionPreserved = 0;
  for (const row of accounts) {
    if (row.provider_config != null) {
      const configWasString = typeof row.provider_config === 'string';
      let config = row.provider_config;
      if (configWasString) {
        try { config = JSON.parse(config); } catch { throw new Error('Trade account provider config is not valid JSON'); }
      }
      if (config && typeof config === 'object' && !Array.isArray(config)) {
        config = structuredClone(config);
        let configChanged = false;
        for (const key of ['symbolCatalog', 'symbol_catalog']) {
          if (!Array.isArray(config[key])) continue;
          const before = config[key];
          const after = sanitizeAccountSymbolCatalog(before);
          catalogNormalization.beforeBytes += Buffer.byteLength(JSON.stringify(before));
          catalogNormalization.afterBytes += Buffer.byteLength(JSON.stringify(after));
          if (stable(before) !== stable(after)) {
            configChanged = true;
            catalogNormalization.catalogsChanged += 1;
          }
          config[key] = after;
        }
        if (configChanged) {
          catalogNormalization.accountsChanged += 1;
          row.provider_config = configWasString ? JSON.stringify(config) : config;
        }
      }
    }
    let policy = row.safety_policy;
    if (typeof policy === 'string') {
      try { policy = JSON.parse(policy); } catch { throw new Error('Trade account safety policy is not valid JSON'); }
    }
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new Error('Trade account safety policy must be a JSON object');
    }
    row.live_execution_enabled = target === 'd1' ? 0 : false;
    if (String(row.environment || '').toLowerCase() === 'demo') {
      // Existing D1/PostgreSQL invariants deliberately enable connected DEMO accounts.
      // The copied global controls below remain disabled, so these cannot execute yet.
      demoExecutionPreserved += 1;
      row.safety_policy = { ...policy };
    } else {
      row.execution_enabled = target === 'd1' ? 0 : false;
      row.safety_policy = { ...policy, killSwitch: true };
      accountsExecutionFenced += 1;
    }
  }

  const workspaces = output.trading_workspace_access;
  if (!Array.isArray(workspaces)) throw new Error('Snapshot trading_workspace_access table is missing');

  catalogNormalization.bytesSaved = catalogNormalization.beforeBytes - catalogNormalization.afterBytes;

  return {
    rowsByTable: output,
    catalogNormalization,
    overrides: {
      globalControlsFenced,
      workspaceAccessPreserved: workspaces.length,
      accountsExecutionFenced,
      demoExecutionPreserved
    }
  };
}

function quoteImportIdentifier(value) {
  const identifier = String(value || '');
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) throw new Error('Snapshot import schema contains an invalid identifier');
  return `"${identifier}"`;
}

function importTableName(sourceName, target) {
  if (target === 'postgres' && sourceName === 'trading_runtime_controls') return 'runtime_controls';
  return sourceName;
}

function importValue(value, target, column) {
  if (value === undefined) throw new Error('Snapshot import row contains an undefined value');
  if (target === 'd1') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value && typeof value === 'object') return JSON.stringify(value);
  }
  if (target === 'postgres' && value !== null && String(column?.type || '').toLowerCase().includes('json')) {
    // PostgREST decodes JSON values into JavaScript values, but node-postgres
    // treats arrays as PostgreSQL arrays and strings as raw text parameters.
    // Serialize every non-null value so JSON strings that happen to contain
    // valid JSON text retain their string meaning, and arrays remain JSON arrays.
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Build deterministic, non-destructive upserts for a previously integrity-verified snapshot.
 * Callers must inspect the returned plan and execute bounded batches transactionally.
 */
export function createTradingSnapshotImportPlan({ snapshot, target, tableDefinitions } = {}) {
  if (!['d1', 'postgres'].includes(target)) throw new Error('Snapshot import target must be d1 or postgres');
  if (!snapshot?.rowsByTable || !Array.isArray(snapshot.tableManifest) || !tableDefinitions || typeof tableDefinitions !== 'object') {
    throw new Error('Snapshot import manifest or target schema is invalid');
  }
  const sourceTables = Object.keys(snapshot.rowsByTable).sort();
  const manifestTables = snapshot.tableManifest.map((entry) => entry?.name).sort();
  if (JSON.stringify(sourceTables) !== JSON.stringify(manifestTables) || new Set(manifestTables).size !== manifestTables.length) {
    throw new Error('Snapshot import table set does not match its verified manifest');
  }

  const statements = [];
  const tableCounts = {};
  for (const manifest of snapshot.tableManifest) {
    const sourceName = manifest.name;
    const targetName = importTableName(sourceName, target);
    const definition = tableDefinitions[targetName];
    if (!definition || !Array.isArray(definition.columns) || !Array.isArray(definition.primaryKeys)) {
      throw new Error(`Snapshot table ${targetName} is missing from target schema`);
    }
    if (JSON.stringify(definition.primaryKeys) !== JSON.stringify(manifest.primaryKeys)) {
      throw new Error(`Snapshot table ${targetName} primary key does not match target schema`);
    }
    const columnsByName = new Map(definition.columns.map((column) => [column.name, column]));
    const quotedTable = target === 'postgres'
      ? `trading_storage.${quoteImportIdentifier(targetName)}`
      : quoteImportIdentifier(targetName);
    const rows = snapshot.rowsByTable[sourceName];
    if (!Array.isArray(rows)) throw new Error(`Snapshot table ${sourceName} does not contain rows`);
    const seen = new Set();
    tableCounts[sourceName] = rows.length;

    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Snapshot row in ${sourceName} is invalid`);
      const key = stable(rowKey(row, manifest.primaryKeys));
      if (seen.has(key)) throw new Error(`Snapshot table ${sourceName} contains a duplicate primary key`);
      seen.add(key);
      const rowColumns = Object.keys(row);
      for (const column of rowColumns) {
        if (!columnsByName.has(column)) throw new Error(`Snapshot column ${targetName}.${column} is missing from target schema`);
      }
      const columns = definition.columns.filter((column) => Object.hasOwn(row, column.name));
      if (columns.length !== rowColumns.length) throw new Error(`Snapshot table ${sourceName} contains unsupported columns`);
      const omittedRequired = definition.columns.find((column) => !Object.hasOwn(row, column.name)
        && (column.nullable === false || column.notNull === true)
        && column.hasDefault !== true);
      if (omittedRequired) throw new Error(`Snapshot row omits required target column ${targetName}.${omittedRequired.name}`);
      const names = columns.map((column) => quoteImportIdentifier(column.name));
      const values = columns.map((column) => importValue(row[column.name], target, column));
      const placeholders = values.map((_, index) => target === 'postgres' ? `$${index + 1}` : '?');
      const conflict = manifest.primaryKeys.map(quoteImportIdentifier).join(', ');
      const updates = columns
        .filter((column) => !manifest.primaryKeys.includes(column.name))
        .map((column) => `${quoteImportIdentifier(column.name)} = EXCLUDED.${quoteImportIdentifier(column.name)}`);
      const conflictAction = updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING';
      const schema = target === 'postgres' ? 'trading_storage.' : '';
      const sql = `INSERT INTO ${schema}${quoteImportIdentifier(targetName)} (${names.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflict}) ${conflictAction}`;
      statements.push({ sourceTable: sourceName, targetTable: targetName, sql, values });
    }
  }
  return { target, rowCount: statements.length, tableCounts, statements };
}

function snapshotTargetNames(tableManifest, target) {
  if (!Array.isArray(tableManifest) || !tableManifest.length) throw new Error('Snapshot target table manifest is invalid');
  return tableManifest.map(({ name }) => importTableName(quoteImportIdentifier(name).slice(1, -1), target));
}

/** Read only the D1 table definitions present in the verified snapshot manifest. */
export async function getD1SnapshotTargetDefinitions(db, tableManifest) {
  if (!db?.prepare) throw new Error('D1 snapshot import binding is unavailable');
  const result = {};
  for (const tableName of snapshotTargetNames(tableManifest, 'd1')) {
    const rowsResult = await db.prepare(`PRAGMA table_info(${quoteImportIdentifier(tableName)})`).all();
    const rows = Array.isArray(rowsResult) ? rowsResult : rowsResult?.results;
    if (!Array.isArray(rows) || !rows.length) throw new Error(`Snapshot table ${tableName} is missing from D1`);
    result[tableName] = {
      columns: rows.map((row) => ({
        name: row.name,
        type: row.type || '',
        nullable: Number(row.notnull) !== 1,
        hasDefault: row.dflt_value != null
      })),
      primaryKeys: rows.filter((row) => Number(row.pk) > 0)
        .sort((left, right) => Number(left.pk) - Number(right.pk)).map((row) => row.name)
    };
  }
  return result;
}

/** Read only the Trading-schema definitions used by the verified snapshot manifest. */
export async function getPostgresSnapshotTargetDefinitions(client, tableManifest) {
  if (!client?.query) throw new Error('PostgreSQL snapshot import client is unavailable');
  const tableNames = snapshotTargetNames(tableManifest, 'postgres');
  const columnsResult = await client.query(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
      FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = ANY($2::text[])
     ORDER BY table_name, ordinal_position
  `, ['trading_storage', tableNames]);
  const keysResult = await client.query(`
    SELECT tc.table_name, kcu.column_name, kcu.ordinal_position
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_catalog = kcu.constraint_catalog
       AND tc.constraint_schema = kcu.constraint_schema
       AND tc.constraint_name = kcu.constraint_name
       AND tc.table_name = kcu.table_name
     WHERE tc.table_schema = $1 AND tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_name = ANY($2::text[])
     ORDER BY tc.table_name, kcu.ordinal_position
  `, ['trading_storage', tableNames]);
  const result = Object.fromEntries(tableNames.map((name) => [name, { columns: [], primaryKeys: [] }]));
  for (const column of columnsResult?.rows || []) {
    if (!result[column.table_name]) throw new Error('PostgreSQL returned a table outside the Trading snapshot manifest');
    result[column.table_name].columns.push({
      name: column.column_name,
      type: column.data_type || column.udt_name || '',
      nullable: column.is_nullable === 'YES',
      hasDefault: column.column_default != null
    });
  }
  for (const key of keysResult?.rows || []) {
    if (!result[key.table_name]) throw new Error('PostgreSQL returned a key outside the Trading snapshot manifest');
    result[key.table_name].primaryKeys.push(key.column_name);
  }
  for (const [tableName, definition] of Object.entries(result)) {
    if (!definition.columns.length) throw new Error(`Snapshot table ${tableName} is missing from PostgreSQL trading_storage`);
  }
  return result;
}

/** Execute a reviewed plan in retry-safe, caller-provided atomic batches. */
export async function applyTradingSnapshotImportPlan(plan, {
  executeBatchAtomically,
  batchSize = 50,
  onBatchCommitted = async () => {}
} = {}) {
  if (!['d1', 'postgres'].includes(plan?.target) || !Array.isArray(plan.statements)
    || plan.rowCount !== plan.statements.length) throw new Error('Snapshot import plan is invalid');
  const size = Number(batchSize);
  if (!Number.isSafeInteger(size) || size < 1 || size > 250) throw new Error('Snapshot import batch size must be between 1 and 250');
  if (typeof executeBatchAtomically !== 'function') throw new Error('Atomic snapshot import batch executor is required');
  if (typeof onBatchCommitted !== 'function') throw new Error('Snapshot import progress callback is invalid');
  assertSnapshotImportUpserts(plan.statements);
  let appliedRows = 0;
  let batches = 0;
  for (let offset = 0; offset < plan.statements.length; offset += size) {
    const batch = plan.statements.slice(offset, offset + size);
    await executeBatchAtomically(batch, { target: plan.target, batchNumber: batches + 1 });
    appliedRows += batch.length;
    batches += 1;
    await onBatchCommitted({ target: plan.target, appliedRows, batchNumber: batches });
  }
  return { target: plan.target, appliedRows, batches };
}

function snapshotImportPlanFingerprint(plan, masterKey) {
  return keyedDigest({
    target: plan.target,
    rowCount: plan.rowCount,
    tableCounts: plan.tableCounts || {},
    statements: plan.statements.map(({ sourceTable, targetTable, sql, values }) => ({ sourceTable, targetTable, sql, values }))
  }, masterKey);
}

function snapshotImportCheckpointMetadata(checkpoint) {
  return {
    format: checkpoint.format,
    target: checkpoint.target,
    planFingerprint: checkpoint.planFingerprint,
    totalRows: checkpoint.totalRows,
    batchSize: checkpoint.batchSize,
    appliedRows: checkpoint.appliedRows,
    batches: checkpoint.batches,
    updatedAt: checkpoint.updatedAt
  };
}

async function writeSnapshotImportCheckpoint(checkpointPath, checkpoint, masterKey) {
  const payload = {
    ...checkpoint,
    signature: keyedDigest(snapshotImportCheckpointMetadata(checkpoint), masterKey)
  };
  const temporaryPath = `${checkpointPath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, checkpointPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

/**
 * Resume an upsert-only import from an HMAC-authenticated local checkpoint.
 * Target batches commit before their checkpoint is advanced; a crash in between safely
 * replays the last idempotent batch. Keep the checkpoint outside the repository and protected
 * alongside the encrypted source artifact. A crashed process may leave `.lock`; verify the
 * old process is gone before an operator removes that stale lock and resumes.
 */
export async function applyTradingSnapshotImportPlanResumable(plan, {
  executeBatchAtomically,
  checkpointPath,
  masterKey,
  batchSize = 50,
  onBatchCommitted = async () => {},
  clock = () => new Date()
} = {}) {
  if (!['d1', 'postgres'].includes(plan?.target) || !Array.isArray(plan.statements)
    || plan.rowCount !== plan.statements.length) throw new Error('Snapshot import plan is invalid');
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required for resumable snapshot import');
  if (!checkpointPath) throw new Error('Snapshot import checkpoint path is required');
  const size = Number(batchSize);
  if (!Number.isSafeInteger(size) || size < 1 || size > 250) throw new Error('Snapshot import batch size must be between 1 and 250');
  if (typeof executeBatchAtomically !== 'function') throw new Error('Atomic snapshot import batch executor is required');
  if (typeof onBatchCommitted !== 'function') throw new Error('Snapshot import progress callback is invalid');
  assertSnapshotImportUpserts(plan.statements);

  const targetPath = await assertOutsideRepository(checkpointPath);
  const lockPath = `${targetPath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('Snapshot import checkpoint is locked; verify no importer is running before resuming');
    throw error;
  }

  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: clock().toISOString() })}\n`, 'utf8');
    await lock.sync();
    const fingerprint = snapshotImportPlanFingerprint(plan, masterKey);
    let checkpoint;
    try {
      checkpoint = JSON.parse(await readFile(targetPath, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('Snapshot import checkpoint is unreadable');
    }

    if (checkpoint) {
      const metadata = snapshotImportCheckpointMetadata(checkpoint);
      if (checkpoint.format !== 'mkety-trading-import-progress-v1'
        || checkpoint.signature !== keyedDigest(metadata, masterKey)) {
        throw new Error('Snapshot import checkpoint integrity check failed');
      }
      if (checkpoint.target !== plan.target || checkpoint.planFingerprint !== fingerprint
        || checkpoint.totalRows !== plan.rowCount || checkpoint.batchSize !== size) {
        throw new Error('Snapshot import checkpoint does not match this snapshot import plan');
      }
      if (!Number.isSafeInteger(checkpoint.appliedRows) || checkpoint.appliedRows < 0
        || checkpoint.appliedRows > plan.rowCount
        || (checkpoint.appliedRows !== plan.rowCount && checkpoint.appliedRows % size !== 0)
        || checkpoint.batches !== Math.ceil(checkpoint.appliedRows / size)) {
        throw new Error('Snapshot import checkpoint progress is invalid');
      }
    } else {
      checkpoint = {
        format: 'mkety-trading-import-progress-v1',
        target: plan.target,
        planFingerprint: fingerprint,
        totalRows: plan.rowCount,
        batchSize: size,
        appliedRows: 0,
        batches: 0,
        updatedAt: clock().toISOString()
      };
      await writeSnapshotImportCheckpoint(targetPath, checkpoint, masterKey);
    }

    const resumedFromRows = checkpoint.appliedRows;
    let appliedRows = checkpoint.appliedRows;
    let batches = checkpoint.batches;
    for (let offset = checkpoint.appliedRows; offset < plan.statements.length; offset += size) {
      const batch = plan.statements.slice(offset, offset + size);
      await executeBatchAtomically(batch, { target: plan.target, batchNumber: batches + 1 });
      appliedRows += batch.length;
      batches += 1;
      checkpoint = {
        ...checkpoint,
        appliedRows,
        batches,
        updatedAt: clock().toISOString()
      };
      await writeSnapshotImportCheckpoint(targetPath, checkpoint, masterKey);
      await onBatchCommitted({ target: plan.target, appliedRows, batchNumber: batches });
    }
    return { target: plan.target, appliedRows, batches, resumedFromRows };
  } finally {
    await lock.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

function assertSnapshotImportUpserts(statements) {
  if (!Array.isArray(statements)) throw new Error('Snapshot import statements are invalid');
  for (const statement of statements) {
    if (!statement || (statement.sourceTable != null && !/^[a-z][a-z0-9_]{0,62}$/.test(statement.sourceTable))
      || (statement.targetTable != null && !/^[a-z][a-z0-9_]{0,62}$/.test(statement.targetTable))
      || typeof statement.sql !== 'string'
      || !/^INSERT INTO (?:trading_storage\.)?"[a-z][a-z0-9_]{0,62}" \(.+\) VALUES \(.+\) ON CONFLICT \(.+\) DO (?:UPDATE SET .+|NOTHING)$/.test(statement.sql)
      || statement.sql.includes(';')
      || !Array.isArray(statement.values)) {
      throw new Error('Snapshot import accepts only allowlisted INSERT upserts');
    }
  }
}

/** Use D1's transactional batch API for each bounded group of already-reviewed upserts. */
export async function applyTradingSnapshotPlanToD1(db, statements) {
  if (!db?.prepare || !db?.batch) throw new Error('D1 snapshot import binding is unavailable');
  assertSnapshotImportUpserts(statements);
  if (!statements.length) return { appliedRows: 0 };
  const prepared = statements.map(({ sql, values }) => db.prepare(sql).bind(...values));
  const result = await db.batch(prepared);
  if (Array.isArray(result) && result.some((item) => item?.success === false)) {
    throw new Error('D1 snapshot import batch failed');
  }
  return { appliedRows: statements.length };
}

/** Wrap each PostgreSQL import group in one transaction; failed groups are fully rolled back. */
export async function applyTradingSnapshotPlanToPostgres(client, statements) {
  if (!client?.query) throw new Error('PostgreSQL snapshot import client is unavailable');
  assertSnapshotImportUpserts(statements);
  if (!statements.length) return { appliedRows: 0 };
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    for (const { sql, values } of statements) await client.query(sql, values);
    await client.query('COMMIT');
    return { appliedRows: statements.length };
  } catch (error) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original target error. */ }
    }
    throw error;
  }
}

async function readReviewedTableInventory() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_SCHEMA_PATH, 'utf8'));
  const inventory = snapshot.tables.map((table) => ({ name: table.name, primaryKeys: table.primaryKeys }));
  if (!inventory.length || inventory.some((table) => !table.name || !table.primaryKeys?.length)) {
    throw new Error('Reviewed Supabase Trading table allowlist is incomplete');
  }
  // Preserve target migration creation order so referenced parent rows are imported first.
  const migrationPaths = [
    resolve(here, '../db/d1-migrations/0001_trading_storage_replication.sql'),
    resolve(here, '../db/d1-migrations/0002_trading_domain_schema.sql')
  ];
  const migrationSql = (await Promise.all(migrationPaths.map((path) => readFile(path, 'utf8')))).join('\n');
  const targetOrder = [...migrationSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(?:"([a-z][a-z0-9_]{0,62})"|([a-z][a-z0-9_]{0,62}))/gi)]
    .map((match) => match[1] || match[2]);
  const order = new Map(targetOrder.map((name, index) => [name, index]));
  if (inventory.some(({ name }) => !order.has(name))) throw new Error('Reviewed snapshot table is absent from the D1 migration order');
  return inventory.sort((left, right) => order.get(left.name) - order.get(right.name));
}

async function loadTableInventory(profile = TRADING_CONTINUITY_PROFILE) {
  if (profile !== TRADING_CONTINUITY_PROFILE) throw new Error('Only the reviewed continuity fresh-start snapshot profile is supported');
  const inventory = await readReviewedTableInventory();
  const selected = inventory.filter(({ name }) => CONTINUITY_TABLE_SET.has(name));
  if (selected.length !== TRADING_CONTINUITY_TABLES.length) throw new Error('Continuity snapshot allowlist does not match the reviewed schema');
  return selected;
}

/** Return all reviewed domain table names in parent-first migration order for a guarded staging reset. */
export async function getTradingSnapshotDomainTableInventory() {
  return readReviewedTableInventory();
}

async function fetchTableRows(client, table, pageSize, { onProgress = async () => {}, pass = 'snapshot' } = {}) {
  const rows = [];
  const keysetEnabled = Boolean(table.primaryKeys?.length === 1);
  const keyColumn = keysetEnabled ? table.primaryKeys[0] : null;
  let lastKey = null;
  let offset = 0;
  let pageNumber = 0;
  for (;;) {
    let query = client.from(table.name).select('*');
    for (const key of table.primaryKeys) query = query.order(key, { ascending: true });
    const supportsKeyset = typeof query.gt === 'function';
    if (supportsKeyset && !keysetEnabled) throw new Error(`Snapshot keyset pagination requires one primary key for ${table.name}`);
    if (supportsKeyset && lastKey !== null) query = query.gt(keyColumn, lastKey);
    const pageOffset = supportsKeyset ? 0 : offset;
    const { data, error } = await query.range(pageOffset, pageOffset + pageSize - 1);
    if (error) {
      const code = /^[A-Z0-9_-]{2,16}$/i.test(String(error.code || '')) ? String(error.code).toUpperCase() : 'UNKNOWN';
      throw new Error(`Supabase snapshot read failed for ${table.name} (${code})`);
    }
    if (!Array.isArray(data)) throw new Error(`Supabase snapshot returned invalid rows for ${table.name}`);
    rows.push(...data);
    if (supportsKeyset && data.length) {
      const nextKey = data[data.length - 1]?.[keyColumn];
      if (nextKey === undefined || nextKey === null || (lastKey !== null && String(nextKey) === String(lastKey))) {
        throw new Error(`Snapshot keyset pagination did not advance for ${table.name}`);
      }
      lastKey = nextKey;
    } else if (!supportsKeyset) {
      offset += pageSize;
    }
    pageNumber += 1;
    if (pageNumber % 25 === 0 || data.length < pageSize) {
      await onProgress({ phase: 'source-read-table', pass, table: table.name, pages: pageNumber, rows: rows.length });
    }
    if (data.length < pageSize) return rows;
  }
}

/** Minimal read-only PostgREST reader for one allowlisted migration export. */
export function createTradingSnapshotRestClient({ url, serviceRole, fetchFn = fetch } = {}) {
  const endpoint = new URL(String(url || ''));
  if (endpoint.protocol !== 'https:' || endpoint.hostname.toLowerCase() !== `${EXPECTED_PROJECT_REF}.supabase.co`) {
    throw new Error('Snapshot source URL does not match the pinned project');
  }
  if (!String(serviceRole || '').trim() || typeof fetchFn !== 'function') {
    throw new Error('Snapshot source read credentials are incomplete');
  }
  return {
    from(tableName) {
      const table = String(tableName || '');
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) throw new Error('Snapshot table name is invalid');
      const order = [];
      const filters = new Map();
      let rangeStart = 0;
      let rangeEnd = 0;
      const query = {
        select(columns) {
          if (columns !== '*') throw new Error('Snapshot export only supports reviewed whole-table reads');
          return query;
        },
        order(key, options = {}) {
          const column = String(key || '');
          if (!/^[a-z][a-z0-9_]{0,62}$/.test(column) || options.ascending === false) {
            throw new Error('Snapshot ordering must use reviewed ascending primary keys');
          }
          order.push(`${column}.asc`);
          return query;
        },
        gt(key, value) {
          const column = String(key || '');
          if (!/^[a-z][a-z0-9_]{0,62}$/.test(column) || value === undefined || value === null) {
            throw new Error('Snapshot keyset cursor is invalid');
          }
          filters.set(column, `gt.${String(value)}`);
          return query;
        },
        async range(from, to) {
          if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to - from > 499) {
            throw new Error('Snapshot range is invalid');
          }
          rangeStart = from;
          rangeEnd = to;
          const requestUrl = new URL(`/rest/v1/${encodeURIComponent(table)}`, endpoint);
          requestUrl.searchParams.set('select', '*');
          if (order.length) requestUrl.searchParams.set('order', order.join(','));
          for (const [column, filter] of filters) requestUrl.searchParams.set(column, filter);
          const response = await fetchFn(requestUrl, {
            method: 'GET',
            headers: {
              apikey: String(serviceRole),
              authorization: `Bearer ${serviceRole}`,
              accept: 'application/json',
              'range-unit': 'items',
              range: `${rangeStart}-${rangeEnd}`,
            },
          });
          let body;
          try { body = await response.json(); } catch { body = null; }
          if (!response.ok) {
            return { data: null, error: { code: body?.code || `HTTP_${response.status}` } };
          }
          return { data: body, error: null };
        },
      };
      return query;
    },
  };
}

function tableManifest(rowsByTable, inventory, checksumKey) {
  return inventory.map(({ name, primaryKeys }) => {
    const rows = [...(rowsByTable[name] || [])].sort((left, right) => {
      const a = rowKey(left, primaryKeys);
      const b = rowKey(right, primaryKeys);
      for (let index = 0; index < a.length; index += 1) {
        const order = a[index].localeCompare(b[index]);
        if (order) return order;
      }
      return 0;
    });
    const seen = new Set();
    const keyedRows = rows.map((row) => {
      const key = rowKey(row, primaryKeys);
      const identity = stable(key);
      if (seen.has(identity)) throw new Error(`Duplicate primary key in snapshot table ${name}`);
      seen.add(identity);
      return { key, sha256: keyedDigest(row, checksumKey) };
    });
    return { name, primaryKeys, rowCount: rows.length, sha256: keyedDigest(keyedRows, checksumKey), keyedRows };
  });
}

export function compareTradingSnapshotTableDrift(initial, current) {
  const initialRows = new Map((initial?.keyedRows || []).map((row) => [stable(row.key), row.sha256]));
  const currentRows = new Map((current?.keyedRows || []).map((row) => [stable(row.key), row.sha256]));
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const [key, checksum] of currentRows) {
    if (!initialRows.has(key)) added += 1;
    else if (initialRows.get(key) !== checksum) modified += 1;
  }
  for (const key of initialRows.keys()) if (!currentRows.has(key)) removed += 1;
  return { added, removed, modified };
}

function snapshotMetadata(artifact) {
  return {
    format: artifact.format,
    profile: artifact.profile,
    sourceProjectRef: artifact.sourceProjectRef,
    cutoverReference: artifact.cutoverReference,
    capturedAt: artifact.capturedAt,
    tableManifest: artifact.tableManifest,
    sourceDrift: artifact.sourceDrift
  };
}

async function assertOutsideRepository(path) {
  const target = resolve(path);
  const actualParent = await realpath(dirname(target));
  const actualTarget = resolve(actualParent, basename(target));
  const prefix = `${REPOSITORY_ROOT}${sep}`;
  if (actualTarget === REPOSITORY_ROOT || actualTarget.startsWith(prefix)) {
    throw new Error('Snapshot output must be outside the repository');
  }
  return actualTarget;
}

/** Export a bounded rolling cutover snapshot while public source writes continue. */
export async function exportTradingDataSnapshot({
  client,
  masterKey,
  cutoverReference,
  sourceProjectRef,
  profile = TRADING_CONTINUITY_PROFILE,
  outputPath,
  pageSize = 200,
  clock = () => new Date(),
  onProgress = async () => {}
} = {}) {
  const request = validateTradingSnapshotRequest({ cutoverReference, sourceProjectRef, pageSize, profile });
  if (!client?.from) throw new Error('Supabase snapshot client is required');
  if (typeof onProgress !== 'function') throw new Error('Snapshot export progress callback is invalid');
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required');
  if (!outputPath) throw new Error('Encrypted snapshot output path is required');
  const targetPath = await assertOutsideRepository(outputPath);
  const inventory = await loadTableInventory(request.profile);

  const firstRead = {};
  for (const table of inventory) firstRead[table.name] = await fetchTableRows(client, table, request.pageSize, { onProgress, pass: 'baseline' });
  const sourceManifest = tableManifest(firstRead, inventory, masterKey);
  // Public ingress remains live. Retain the newest complete pass and bound the
  // drift; an explicit final refresh keeps owner identity and settings close to
  // the chosen cutover point without claiming a globally atomic source snapshot.
  const sourceDrift = [];
  const rollingRows = {};
  let totalDrift = 0;
  for (const table of inventory) {
    const currentRows = await fetchTableRows(client, table, request.pageSize, { onProgress, pass: 'rolling' });
    rollingRows[table.name] = currentRows;
    const currentManifest = tableManifest({ [table.name]: currentRows }, [table], masterKey);
    const expected = sourceManifest.find((entry) => entry.name === table.name);
    const drift = compareTradingSnapshotTableDrift(expected, currentManifest[0]);
    if (drift.added || drift.removed || drift.modified) {
      const changedRows = drift.added + drift.removed + drift.modified;
      if (changedRows > MAX_LIVE_CUTOVER_DRIFT_PER_TABLE) throw new Error(`Live source drift exceeded the safe cutover bound at table ${table.name}`);
      totalDrift += changedRows;
      if (totalDrift > MAX_LIVE_CUTOVER_DRIFT_TOTAL) throw new Error('Live source drift exceeded the total safe cutover bound');
      sourceDrift.push({ table: table.name, ...drift });
    }
    if (currentManifest[0].rowCount !== expected.rowCount + drift.added - drift.removed) throw new Error(`Source changed inconsistently during snapshot export at table ${table.name}`);
  }

  for (const table of inventory) {
    if (!CUTOVER_REFRESH_TABLES.has(table.name)) continue;
    const latestRows = await fetchTableRows(client, table, request.pageSize, { onProgress, pass: 'cutover-refresh' });
    const latestManifest = tableManifest({ [table.name]: latestRows }, [table], masterKey)[0];
    const previousManifest = tableManifest({ [table.name]: rollingRows[table.name] }, [table], masterKey)[0];
    const drift = compareTradingSnapshotTableDrift(previousManifest, latestManifest);
    const changedRows = drift.added + drift.removed + drift.modified;
    if (changedRows) {
      if (changedRows > MAX_LIVE_CUTOVER_DRIFT_PER_TABLE) throw new Error(`Live source drift exceeded the safe cutover bound at table ${table.name}`);
      totalDrift += changedRows;
      if (totalDrift > MAX_LIVE_CUTOVER_DRIFT_TOTAL) throw new Error('Live source drift exceeded the total safe cutover bound');
      const prior = sourceDrift.find((entry) => entry.table === table.name);
      if (prior) {
        prior.added += drift.added;
        prior.removed += drift.removed;
        prior.modified += drift.modified;
        if (prior.added + prior.removed + prior.modified > MAX_LIVE_CUTOVER_DRIFT_PER_TABLE) {
          throw new Error(`Live source drift exceeded the safe cutover bound at table ${table.name}`);
        }
      } else sourceDrift.push({ table: table.name, ...drift });
    }
    rollingRows[table.name] = latestRows;
  }

  const snapshotSourceRows = await prepareTradingSnapshotRows(rollingRows, { masterKey });
  const manifest = tableManifest(snapshotSourceRows, inventory, masterKey);

  const artifact = {
    format: FORMAT,
    profile: request.profile,
    sourceProjectRef: request.sourceProjectRef,
    cutoverReference: request.cutoverReference,
    capturedAt: clock().toISOString(),
    sourceDrift,
    tableManifest: manifest.map(({ name, primaryKeys, rowCount, sha256 }) => ({ name, primaryKeys, rowCount, sha256 })),
    payloadCiphertext: await encryptSecret(JSON.stringify(snapshotSourceRows), masterKey)
  };
  artifact.metadataHmac = keyedDigest(snapshotMetadata(artifact), masterKey);
  await writeFile(targetPath, `${JSON.stringify(artifact)}\n`, { mode: 0o600, flag: 'wx' });
  return {
    format: artifact.format,
    profile: artifact.profile,
    outputPath: targetPath,
    sourceProjectRef: artifact.sourceProjectRef,
    capturedAt: artifact.capturedAt,
    tableManifest: artifact.tableManifest,
    sourceDrift: artifact.sourceDrift,
    totalDrift
  };
}

export async function readTradingDataSnapshot({ artifactPath, masterKey } = {}) {
  if (!artifactPath) throw new Error('Encrypted snapshot path is required');
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  if (artifact?.format !== FORMAT) throw new Error('Trading data snapshot format is unsupported');
  safeProjectRef(artifact.sourceProjectRef);
  validateTradingSnapshotRequest({
    cutoverReference: artifact.cutoverReference,
    sourceProjectRef: artifact.sourceProjectRef,
    pageSize: 1,
    profile: artifact.profile
  });
  if (!Array.isArray(artifact.tableManifest)) throw new Error('Trading data snapshot manifest is invalid');
  if (!Array.isArray(artifact.sourceDrift) || artifact.sourceDrift.some((drift) => (
    typeof drift?.table !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(drift.table)
    || !['added', 'removed', 'modified'].every((key) => Number.isSafeInteger(drift[key]) && drift[key] >= 0)
    || drift.added + drift.removed + drift.modified > MAX_LIVE_CUTOVER_DRIFT_PER_TABLE
  )) || artifact.sourceDrift.reduce((sum, drift) => sum + drift.added + drift.removed + drift.modified, 0) > MAX_LIVE_CUTOVER_DRIFT_TOTAL) {
    throw new Error('Trading data snapshot drift manifest is invalid');
  }
  if (artifact.metadataHmac !== keyedDigest(snapshotMetadata(artifact), masterKey)) {
    throw new Error('Trading data snapshot metadata integrity check failed');
  }
  const rowsByTable = JSON.parse(await decryptSecret(artifact.payloadCiphertext, masterKey));
  const inventory = await loadTableInventory(artifact.profile);
  if (!rowsByTable || typeof rowsByTable !== 'object' || Array.isArray(rowsByTable)) {
    throw new Error('Trading data snapshot payload is invalid');
  }
  const expectedTables = inventory.map((table) => table.name).sort();
  const actualTables = Object.keys(rowsByTable).sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    throw new Error('Trading data snapshot table set is incomplete or unsupported');
  }
  const verifiedManifest = tableManifest(rowsByTable, inventory, masterKey);
  const expectedManifest = artifact.tableManifest;
  if (expectedManifest.length !== verifiedManifest.length) throw new Error('Trading data snapshot table set is incomplete');
  for (let index = 0; index < verifiedManifest.length; index += 1) {
    const expected = expectedManifest[index];
    const actual = verifiedManifest[index];
    if (expected?.name !== actual.name || JSON.stringify(expected?.primaryKeys) !== JSON.stringify(actual.primaryKeys)
      || expected?.rowCount !== actual.rowCount || expected?.sha256 !== actual.sha256) {
      throw new Error(`Trading data snapshot integrity check failed for table ${actual.name}`);
    }
  }
  // Re-run the secret projection check after decryption; plaintext legacy credential columns are never importable.
  for (const [table, rows] of Object.entries(rowsByTable)) {
    if (!inventory.some((entry) => entry.name === table)) throw new Error(`Trading data snapshot contains an unsupported table ${table}`);
    for (const row of rows) {
      if (Object.hasOwn(row, 'tg_bot_token') || Object.hasOwn(row, 'api_key')) {
        throw new Error(`Trading data snapshot contains plaintext credentials in ${table}`);
      }
    }
  }
  return { profile: artifact.profile, sourceProjectRef: artifact.sourceProjectRef, cutoverReference: artifact.cutoverReference, capturedAt: artifact.capturedAt, tableManifest: expectedManifest, sourceDrift: artifact.sourceDrift, rowsByTable };
}

async function main() {
  const sourceProjectRef = process.env.TRADING_MIGRATION_SOURCE_PROJECT_REF;
  const outputPath = process.env.TRADING_MIGRATION_SNAPSHOT_PATH;
  const masterKey = process.env.TRADING_MASTER_KEY;
  const cutoverReference = process.env.TRADING_MIGRATION_CUTOVER_REFERENCE;
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceRole) throw new Error('Supabase migration read credentials are required');
  const configuredHost = new URL(url).hostname.toLowerCase();
  if (configuredHost !== `${EXPECTED_PROJECT_REF}.supabase.co`) {
    throw new Error('SUPABASE_URL does not match the pinned Trading source project');
  }
  const client = createTradingSnapshotRestClient({ url, serviceRole });
  const result = await exportTradingDataSnapshot({
    client,
    masterKey,
    cutoverReference,
    sourceProjectRef,
    profile: TRADING_CONTINUITY_PROFILE,
    outputPath,
    pageSize: Number(process.env.TRADING_MIGRATION_PAGE_SIZE || 200)
  });
  for (const table of result.tableManifest) {
    process.stdout.write(`${table.name}\t${table.rowCount}\t${table.sha256}\n`);
  }
  for (const drift of result.sourceDrift) {
    process.stdout.write(`source_drift\t${drift.table}\tadded=${drift.added}\n`);
  }
  process.stdout.write(`encrypted_snapshot_written\t${result.capturedAt}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || 'Trading data snapshot failed'}\n`);
    process.exitCode = 1;
  });
}
