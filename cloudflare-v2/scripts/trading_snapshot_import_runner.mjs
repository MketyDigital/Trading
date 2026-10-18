import { access, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyTradingSnapshotImportPlanResumable,
  applyTradingSnapshotPlanToD1,
  applyTradingSnapshotPlanToPostgres,
  createTradingSnapshotImportPlan,
  getD1SnapshotTargetDefinitions,
  getPostgresSnapshotTargetDefinitions,
  getTradingSnapshotDomainTableInventory,
  prepareTradingSnapshotForImport,
  TRADING_CONTINUITY_PROFILE,
  TRADING_CONTINUITY_TABLE_COUNT,
} from './trading_data_snapshot.mjs';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const PAGE_SIZE = 250;
export const APPROVED_TRADING_D1_ID = '4f00d59a-3d90-4146-832d-36230d5648bb';
const SNAPSHOT_RUNNER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function assertTradingSnapshotTargetIdentities({ d1Database, postgresClient } = {}) {
  if (d1Database?.identity?.databaseName !== 'trading-staging'
    || d1Database?.identity?.databaseId !== APPROVED_TRADING_D1_ID) {
    throw new Error('Trading import requires the approved existing trading-staging D1 database');
  }
  if (!postgresClient?.query) throw new Error('Existing mkety PostgreSQL target is unavailable');
  let result;
  try {
    result = await postgresClient.query('SELECT current_database() AS database_name');
  } catch {
    throw new Error('Trading PostgreSQL target identity check failed');
  }
  if (result?.rows?.length !== 1 || result.rows[0]?.database_name !== 'mkety') {
    throw new Error('Trading import requires the existing mkety PostgreSQL database');
  }
  return { d1: 'trading-staging', postgres: 'mkety' };
}

/** Fail before target reset if prior import progress or an active importer may exist. */
export async function assertFreshStartCheckpointPathsClear(checkpointPaths = {}) {
  for (const target of ['d1', 'postgres']) {
    const checkpointPath = checkpointPaths[target];
    if (typeof checkpointPath !== 'string' || !isAbsolute(checkpointPath)) {
      throw new Error('Fresh-start reset requires absolute per-target import checkpoint paths');
    }
    const parent = await realpath(dirname(checkpointPath));
    const actualPath = resolve(parent, basename(checkpointPath));
    const repoPrefix = `${SNAPSHOT_RUNNER_ROOT}${sep}`;
    if (actualPath === SNAPSHOT_RUNNER_ROOT || actualPath.startsWith(repoPrefix)) {
      throw new Error('Snapshot import checkpoints must remain outside the repository');
    }
    for (const path of [checkpointPath, `${checkpointPath}.lock`]) {
      try {
        await access(path);
        throw new Error('Fresh-start reset refused: existing import checkpoint or lock must be reviewed before reset');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return true;
}

/** Enable writes in the existing D1 only after exact parity is confirmed on both targets. */
export async function activatePopulatedTradingD1Authority({ database, parity } = {}) {
  if (!database?.query || parity?.d1?.target !== 'd1' || parity?.postgres?.target !== 'postgres'
    || parity.d1.tables !== TRADING_CONTINUITY_TABLE_COUNT || parity.postgres.tables !== TRADING_CONTINUITY_TABLE_COUNT
    || parity.d1.rows !== parity.postgres.rows || !Number.isSafeInteger(parity.d1.rows)) {
    throw new Error('D1 authority activation requires complete D1 and PostgreSQL parity verification');
  }
  const readControl = async () => {
    const result = await database.query(`
      SELECT active_authority, authority_epoch, writes_fenced
        FROM trading_storage_control WHERE singleton_id = 1
    `, []);
    if (result?.results?.length !== 1) throw new Error('D1 authority control row is missing');
    return result.results[0];
  };
  let control = await readControl();
  if (control.active_authority !== 'd1' || Number(control.authority_epoch) !== 1) {
    throw new Error('Existing D1 authority state is not the reviewed epoch 1');
  }
  const fenced = Number(control.writes_fenced);
  if (fenced === 1) {
    const updated = await database.query(`
      UPDATE trading_storage_control
         SET writes_fenced = 0, updated_at = CURRENT_TIMESTAMP
       WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = 1 AND writes_fenced = 1
    `, []);
    if (Number(updated?.meta?.changes) !== 1) throw new Error('Existing D1 authority could not be safely unfenced');
    control = await readControl();
  } else if (fenced !== 0) {
    throw new Error('Existing D1 authority fence state is invalid');
  }
  if (control.active_authority !== 'd1' || Number(control.authority_epoch) !== 1 || Number(control.writes_fenced) !== 0) {
    throw new Error('Existing D1 authority activation could not be verified');
  }
  return { authority: 'd1', authorityEpoch: 1, writesFenced: false };
}

async function fenceD1StorageWrites(database) {
  let result = await database.query(`
    SELECT active_authority, authority_epoch, writes_fenced
      FROM trading_storage_control WHERE singleton_id = 1
  `, []);
  let row = result?.results?.[0];
  if (result?.results?.length !== 1 || row.active_authority !== 'd1' || Number(row.authority_epoch) !== 1) {
    throw new Error('Fresh-start reset refused: D1 authority identity is not the reviewed staging epoch');
  }
  if (Number(row.writes_fenced) === 0) {
    await database.query(`
      UPDATE trading_storage_control SET writes_fenced = 1, updated_at = CURRENT_TIMESTAMP
       WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = 1 AND writes_fenced = 0
    `, []);
    result = await database.query(`
      SELECT active_authority, authority_epoch, writes_fenced
        FROM trading_storage_control WHERE singleton_id = 1
    `, []);
    row = result?.results?.[0];
  }
  if (row?.active_authority !== 'd1' || Number(row.authority_epoch) !== 1 || Number(row.writes_fenced) !== 1) {
    throw new Error('Fresh-start reset refused: D1 storage writes could not be fenced');
  }
}

async function fencePostgresStorageWrites(client) {
  let result = await client.query(`
    SELECT active_authority, authority_epoch, writes_fenced
      FROM trading_storage.authority_control WHERE singleton_id = 1
  `, []);
  let row = result?.rows?.[0];
  if (result?.rows?.length !== 1 || row.active_authority !== 'd1' || Number(row.authority_epoch) !== 1) {
    throw new Error('Fresh-start reset refused: PostgreSQL authority identity is not the reviewed staging epoch');
  }
  if (row.writes_fenced !== true) {
    await client.query(`
      UPDATE trading_storage.authority_control SET writes_fenced = true, updated_at = CURRENT_TIMESTAMP
       WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = 1
    `, []);
    result = await client.query(`
      SELECT active_authority, authority_epoch, writes_fenced
        FROM trading_storage.authority_control WHERE singleton_id = 1
    `, []);
    row = result?.rows?.[0];
  }
  if (row?.active_authority !== 'd1' || Number(row.authority_epoch) !== 1 || row.writes_fenced !== true) {
    throw new Error('Fresh-start reset refused: PostgreSQL storage writes could not be fenced');
  }
}

/**
 * Remove prior/partial target data from only the reviewed Trading domain tables.
 * Storage authority, replication metadata, and all non-Trading schemas are preserved.
 */
export async function resetTradingContinuityTargets({ d1Database, postgresClient, checkpointPaths, onProgress = async () => {} } = {}) {
  if (d1Database?.identity?.databaseName !== 'trading-staging'
    || d1Database?.identity?.databaseId !== APPROVED_TRADING_D1_ID
    || !postgresClient?.query) throw new Error('Fresh-start reset requires the approved existing staging targets');
  await assertFreshStartCheckpointPathsClear(checkpointPaths);
  if (typeof d1Database.deleteAllDomainTables !== 'function') throw new Error('D1 adapter does not support guarded fresh-start reset');
  const domainInventory = await getTradingSnapshotDomainTableInventory();
  if (domainInventory.length !== 28) throw new Error('Fresh-start reset table inventory is not the reviewed 28-table domain schema');
  const domainTableNames = domainInventory.map(({ name }) => name);
  if (new Set(domainTableNames).size !== domainTableNames.length) throw new Error('Fresh-start reset table inventory contains duplicates');
  await assertTradingSnapshotTargetIdentities({ d1Database, postgresClient });
  await fenceD1StorageWrites(d1Database);
  await fencePostgresStorageWrites(postgresClient);
  await onProgress({ phase: 'fresh-start-reset-start', tables: domainTableNames.length });
  await d1Database.deleteAllDomainTables(domainTableNames);
  await onProgress({ phase: 'fresh-start-reset-target', target: 'd1', tables: domainTableNames.length });

  let transactionStarted = false;
  try {
    await postgresClient.query('BEGIN');
    transactionStarted = true;
    await postgresClient.query("SET LOCAL statement_timeout = '120s'");
    for (const sourceName of [...domainTableNames].reverse()) {
      const targetName = sourceName === 'trading_runtime_controls' ? 'runtime_controls' : sourceName;
      if (!IDENTIFIER.test(targetName)) throw new Error('Fresh-start reset contains an invalid domain table name');
      await postgresClient.query(`DELETE FROM trading_storage."${targetName}"`);
    }
    await postgresClient.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try { await postgresClient.query('ROLLBACK'); } catch { /* Keep the original reset failure. */ }
    }
    throw error;
  }
  await onProgress({ phase: 'fresh-start-reset-target', target: 'postgres', tables: domainTableNames.length });
  return { tablesResetPerTarget: domainTableNames.length, storageAuthorityPreserved: true, writesFenced: true };
}

export async function verifyTradingSnapshotExcludedTablesEmpty({ target, database, includedTableNames, onProgress = async () => {} } = {}) {
  if (!['d1', 'postgres'].includes(target) || !database?.query || !Array.isArray(includedTableNames)) {
    throw new Error('Excluded-table verification inputs are invalid');
  }
  if (typeof onProgress !== 'function') throw new Error('Excluded-table progress callback is invalid');
  const inventory = await getTradingSnapshotDomainTableInventory();
  const included = new Set(includedTableNames);
  const excluded = inventory.filter(({ name }) => !included.has(name));
  const counts = {};
  for (const { name } of excluded) {
    const tableName = target === 'postgres' && name === 'trading_runtime_controls' ? 'runtime_controls' : name;
    const sql = target === 'postgres'
      ? `SELECT COUNT(*) AS row_count FROM trading_storage."${tableName}"`
      : `SELECT COUNT(*) AS row_count FROM "${tableName}"`;
    const result = await database.query(sql, []);
    const rows = target === 'postgres' ? result?.rows : result?.results;
    const count = Number(rows?.[0]?.row_count);
    if (!Number.isSafeInteger(count) || count !== 0) throw new Error(`Fresh-start excluded table is not empty: ${name}`);
    counts[name] = count;
    await onProgress({ phase: 'target-excluded-table', target, table: name, rows: count });
  }
  return { target, tables: excluded.length, rows: 0, verifiedTables: counts };
}

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(String(value || ''))) throw new Error('Snapshot parity contains an invalid identifier');
  return `"${value}"`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function targetTableName(sourceName, target) {
  return target === 'postgres' && sourceName === 'trading_runtime_controls' ? 'runtime_controls' : sourceName;
}

function normalizeValue(value, column, target) {
  if (value instanceof Date) return value.toISOString();
  const type = String(column?.type || '').toLowerCase();
  if (value == null) return null;
  if (target === 'd1') {
    if (type.includes('int') && typeof value === 'boolean') return value ? 1 : 0;
    if ((type.includes('json') || type === 'text') && typeof value === 'string') {
      try { return JSON.parse(value); } catch { return value; }
    }
  } else if (type.includes('json') && typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  if (/smallint|integer|bigint|numeric|decimal|real|double precision/.test(type)) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (/smallint|integer|bigint/.test(type) && Number.isInteger(numeric)
        && !Number.isSafeInteger(numeric)) return String(value);
      return numeric;
    }
  }
  if (type.includes('bool')) {
    if (value === 1 || value === '1' || value === 't') return true;
    if (value === 0 || value === '0' || value === 'f') return false;
  }
  if (/timestamp|date/.test(type) && typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return value;
}

// Report only structural facts when parity fails. Never include setting or
// credential values in workflow output.
function parityShape(value) {
  if (value === null) return { kind: 'null' };
  if (Array.isArray(value)) return { kind: 'array', length: value.length };
  if (typeof value === 'object') return { kind: 'object', keys: Object.keys(value).length };
  if (typeof value === 'string') return { kind: 'string', length: value.length };
  return { kind: typeof value };
}

function rowIdentity(row, primaryKeys, definition, target) {
  return stable(primaryKeys.map((key) => normalizeValue(row[key], definition.columns.find((column) => column.name === key), target)));
}

async function readPage(database, target, tableName, columns, primaryKeys, offset) {
  const selectColumns = columns.map((column) => quoteIdentifier(column.name)).join(', ');
  const order = primaryKeys.map(quoteIdentifier).join(', ');
  const schema = target === 'postgres' ? '"trading_storage".' : '';
  const sql = `SELECT ${selectColumns} FROM ${schema}${quoteIdentifier(tableName)} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
  const result = await database.query(sql, []);
  const rows = target === 'postgres' ? result?.rows : result?.results;
  if (!Array.isArray(rows)) throw new Error(`Snapshot parity query failed for ${tableName}`);
  return rows;
}

/** Compare a target with the exact projected snapshot, including keys and row content. */
export async function verifyTradingSnapshotTarget({
  target,
  database,
  rowsByTable,
  tableManifest,
  tableDefinitions,
  masterKey,
  onProgress = async () => {},
} = {}) {
  if (!['d1', 'postgres'].includes(target)) throw new Error('Snapshot target must be d1 or postgres');
  if (!database?.query || !rowsByTable || !Array.isArray(tableManifest) || !tableDefinitions) {
    throw new Error('Snapshot target parity inputs are invalid');
  }
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required for target parity');
  const verifiedRows = {};
  let totalRows = 0;
  for (const manifest of tableManifest) {
    const sourceName = manifest?.name;
    if (!IDENTIFIER.test(String(sourceName || '')) || !Array.isArray(manifest?.primaryKeys) || !manifest.primaryKeys.length) {
      throw new Error('Snapshot target parity manifest is invalid');
    }
    const expected = rowsByTable[sourceName];
    const tableName = targetTableName(sourceName, target);
    const definition = tableDefinitions[tableName];
    if (!Array.isArray(expected) || !definition?.columns?.length
      || stable(definition.primaryKeys) !== stable(manifest.primaryKeys)) {
      throw new Error(`Snapshot target parity schema does not match ${sourceName}`);
    }
    const columns = Object.keys(expected[0] || {}).map((name) => {
      const column = definition.columns.find((candidate) => candidate.name === name);
      if (!column) throw new Error(`Snapshot target parity column is missing for ${sourceName}`);
      return column;
    });
    if (expected.length === 0) {
      // Empty source tables still need an exact target count check; select a primary key only.
      for (const key of manifest.primaryKeys) {
        if (!definition.columns.some((column) => column.name === key)) throw new Error(`Snapshot target parity key is missing for ${sourceName}`);
      }
      columns.push(...manifest.primaryKeys.filter((key) => !columns.some((column) => column.name === key))
        .map((key) => definition.columns.find((column) => column.name === key)));
    }
    const expectedByKey = new Map();
    for (const row of expected) {
      const identity = rowIdentity(row, manifest.primaryKeys, definition, target);
      if (expectedByKey.has(identity)) throw new Error(`Snapshot target parity source has duplicate keys for ${sourceName}`);
      expectedByKey.set(identity, row);
    }
    const seen = new Set();
    let pageNumber = 0;
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const rows = await readPage(database, target, tableName, columns, manifest.primaryKeys, offset);
      for (const row of rows) {
        const identity = rowIdentity(row, manifest.primaryKeys, definition, target);
        const source = expectedByKey.get(identity);
        if (!source || seen.has(identity)) throw new Error(`Snapshot parity mismatch for ${sourceName}`);
        for (const column of columns) {
          const actual = normalizeValue(row[column.name], column, target);
          const expectedValue = normalizeValue(source[column.name], column, target);
          if (stable(actual) !== stable(expectedValue)) {
            await onProgress({
              phase: 'target-parity-mismatch', target, table: sourceName, column: column.name,
              actualShape: parityShape(actual), expectedShape: parityShape(expectedValue),
            });
            // Column name and value shapes diagnose representation drift;
            // never log the row or its credentials.
            throw new Error(`Snapshot parity mismatch for ${sourceName}.${column.name} (${target})`);
          }
        }
        seen.add(identity);
      }
      pageNumber += 1;
      if (pageNumber % 20 === 0) await onProgress({ phase: 'target-parity-page', target, table: sourceName, pages: pageNumber, rows: seen.size });
      if (rows.length < PAGE_SIZE) break;
    }
    if (seen.size !== expected.length) throw new Error(`Snapshot parity mismatch for ${sourceName}`);
    verifiedRows[sourceName] = seen.size;
    totalRows += seen.size;
    await onProgress({ phase: 'target-parity-table', target, table: sourceName, rows: seen.size, totalRows });
  }
  return { target, tables: tableManifest.length, rows: totalRows, verifiedRows };
}

/**
 * Import one authenticated snapshot into the two explicitly supplied existing targets.
 * This routine never creates databases or deletes target rows; callers must separately
 * verify target identity and preserve the source snapshot outside the repository.
 */
export async function importTradingSnapshotToTargets({
  snapshot,
  d1Database,
  postgresClient,
  masterKey,
  checkpointPaths,
  batchSize = 50,
  onProgress = async () => {},
} = {}) {
  if (!snapshot?.rowsByTable || !Array.isArray(snapshot.tableManifest)) throw new Error('Verified Trading snapshot is required');
  if (snapshot.profile !== TRADING_CONTINUITY_PROFILE || snapshot.tableManifest.length !== TRADING_CONTINUITY_TABLE_COUNT) {
    throw new Error('Only the verified continuity fresh-start snapshot can be imported');
  }
  if (!d1Database?.query || !d1Database?.prepare || !d1Database?.batch) throw new Error('Existing Trading D1 target is unavailable');
  if (!postgresClient?.query) throw new Error('Existing mkety PostgreSQL target is unavailable');
  if (!masterKey || !checkpointPaths?.d1 || !checkpointPaths?.postgres) throw new Error('Master key and protected per-target checkpoints are required');
  if (typeof onProgress !== 'function') throw new Error('Snapshot import progress callback is invalid');
  await assertTradingSnapshotTargetIdentities({ d1Database, postgresClient });

  const fenced = prepareTradingSnapshotForImport(snapshot.rowsByTable, { target: 'd1' });
  const projectedSnapshot = { ...snapshot, rowsByTable: fenced.rowsByTable };
  const [d1Definitions, pgDefinitions] = await Promise.all([
    getD1SnapshotTargetDefinitions(d1Database, snapshot.tableManifest),
    getPostgresSnapshotTargetDefinitions(postgresClient, snapshot.tableManifest),
  ]);
  const d1Plan = createTradingSnapshotImportPlan({ snapshot: projectedSnapshot, target: 'd1', tableDefinitions: d1Definitions });
  const pgProjection = prepareTradingSnapshotForImport(snapshot.rowsByTable, { target: 'postgres' });
  const pgPlan = createTradingSnapshotImportPlan({ snapshot: { ...snapshot, rowsByTable: pgProjection.rowsByTable }, target: 'postgres', tableDefinitions: pgDefinitions });

  const reset = await resetTradingContinuityTargets({ d1Database, postgresClient, checkpointPaths, onProgress });

  await onProgress({ phase: 'target-import-start', target: 'd1', rows: d1Plan.rowCount });
  const d1Import = await applyTradingSnapshotImportPlanResumable(d1Plan, {
    executeBatchAtomically: (statements) => applyTradingSnapshotPlanToD1(d1Database, statements),
    checkpointPath: checkpointPaths.d1,
    masterKey,
    batchSize: Math.min(batchSize, 100),
    onBatchCommitted: (progress) => onProgress({ phase: 'target-import-batch', ...progress }),
  });
  await onProgress({ phase: 'target-import-start', target: 'postgres', rows: pgPlan.rowCount });
  const pgImport = await applyTradingSnapshotImportPlanResumable(pgPlan, {
    executeBatchAtomically: (statements, batch) => applyTradingSnapshotPlanToPostgres(postgresClient, statements, {
      onStatementStart: ({ table, queryNumber }) => onProgress({
        phase: 'target-import-query', target: 'postgres', batchNumber: batch?.batchNumber, table, queryNumber,
      }),
    }),
    checkpointPath: checkpointPaths.postgres,
    masterKey,
    batchSize,
    onBatchCommitted: (progress) => onProgress({ phase: 'target-import-batch', ...progress }),
  });
  await onProgress({ phase: 'target-parity-start', target: 'd1' });
  await onProgress({ phase: 'target-parity-start', target: 'postgres' });

  const [d1Parity, postgresParity] = await Promise.all([
    verifyTradingSnapshotTarget({ target: 'd1', database: d1Database, rowsByTable: fenced.rowsByTable,
      tableManifest: snapshot.tableManifest, tableDefinitions: d1Definitions, masterKey, onProgress }),
    verifyTradingSnapshotTarget({ target: 'postgres', database: postgresClient, rowsByTable: pgProjection.rowsByTable,
      tableManifest: snapshot.tableManifest, tableDefinitions: pgDefinitions, masterKey, onProgress }),
  ]);
  const [d1ExcludedParity, postgresExcludedParity] = await Promise.all([
    verifyTradingSnapshotExcludedTablesEmpty({ target: 'd1', database: d1Database, includedTableNames: snapshot.tableManifest.map(({ name }) => name), onProgress }),
    verifyTradingSnapshotExcludedTablesEmpty({ target: 'postgres', database: postgresClient, includedTableNames: snapshot.tableManifest.map(({ name }) => name), onProgress }),
  ]);
  const authority = await activatePopulatedTradingD1Authority({
    database: d1Database,
    parity: { d1: d1Parity, postgres: postgresParity },
  });
  return {
    source: { projectRef: snapshot.sourceProjectRef, capturedAt: snapshot.capturedAt, cutoverReference: snapshot.cutoverReference },
    profile: snapshot.profile,
    reset,
    fences: fenced.overrides,
    catalogNormalization: fenced.catalogNormalization,
    d1Import,
    postgresImport: pgImport,
    d1Parity,
    postgresParity,
    d1ExcludedParity,
    postgresExcludedParity,
    authority,
  };
}
