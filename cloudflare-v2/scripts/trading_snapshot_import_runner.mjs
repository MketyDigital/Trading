import {
  applyTradingSnapshotImportPlanResumable,
  applyTradingSnapshotPlanToD1,
  applyTradingSnapshotPlanToPostgres,
  createTradingSnapshotImportPlan,
  getD1SnapshotTargetDefinitions,
  getPostgresSnapshotTargetDefinitions,
  prepareTradingSnapshotForImport,
} from './trading_data_snapshot.mjs';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;
const PAGE_SIZE = 250;
export const APPROVED_TRADING_D1_ID = '4f00d59a-3d90-4146-832d-36230d5648bb';

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

/** Enable writes in the existing D1 only after exact parity is confirmed on both targets. */
export async function activatePopulatedTradingD1Authority({ database, parity } = {}) {
  if (!database?.query || parity?.d1?.target !== 'd1' || parity?.postgres?.target !== 'postgres'
    || parity.d1.tables !== 28 || parity.postgres.tables !== 28
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
      try { return stable(JSON.parse(value)); } catch { return value; }
    }
  } else if (type.includes('json') && typeof value === 'string') {
    try { return stable(JSON.parse(value)); } catch { return value; }
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
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const rows = await readPage(database, target, tableName, columns, manifest.primaryKeys, offset);
      for (const row of rows) {
        const identity = rowIdentity(row, manifest.primaryKeys, definition, target);
        const source = expectedByKey.get(identity);
        if (!source || seen.has(identity)) throw new Error(`Snapshot parity mismatch for ${sourceName}`);
        const projected = {};
        for (const column of columns) {
          projected[column.name] = normalizeValue(row[column.name], column, target);
        }
        const expectedProjected = {};
        for (const column of columns) {
          expectedProjected[column.name] = normalizeValue(source[column.name], column, target);
        }
        if (stable(projected) !== stable(expectedProjected)) throw new Error(`Snapshot parity mismatch for ${sourceName}`);
        seen.add(identity);
      }
      if (rows.length < PAGE_SIZE) break;
    }
    if (seen.size !== expected.length) throw new Error(`Snapshot parity mismatch for ${sourceName}`);
    verifiedRows[sourceName] = seen.size;
    totalRows += seen.size;
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

  const d1Import = await applyTradingSnapshotImportPlanResumable(d1Plan, {
    executeBatchAtomically: (statements) => applyTradingSnapshotPlanToD1(d1Database, statements),
    checkpointPath: checkpointPaths.d1,
    masterKey,
    batchSize: Math.min(batchSize, 100),
    onBatchCommitted: onProgress,
  });
  const pgImport = await applyTradingSnapshotImportPlanResumable(pgPlan, {
    executeBatchAtomically: (statements) => applyTradingSnapshotPlanToPostgres(postgresClient, statements),
    checkpointPath: checkpointPaths.postgres,
    masterKey,
    batchSize,
    onBatchCommitted: onProgress,
  });

  const [d1Parity, postgresParity] = await Promise.all([
    verifyTradingSnapshotTarget({ target: 'd1', database: d1Database, rowsByTable: fenced.rowsByTable,
      tableManifest: snapshot.tableManifest, tableDefinitions: d1Definitions, masterKey }),
    verifyTradingSnapshotTarget({ target: 'postgres', database: postgresClient, rowsByTable: pgProjection.rowsByTable,
      tableManifest: snapshot.tableManifest, tableDefinitions: pgDefinitions, masterKey }),
  ]);
  const authority = await activatePopulatedTradingD1Authority({
    database: d1Database,
    parity: { d1: d1Parity, postgres: postgresParity },
  });
  return {
    source: { projectRef: snapshot.sourceProjectRef, capturedAt: snapshot.capturedAt, cutoverReference: snapshot.cutoverReference },
    fences: fenced.overrides,
    catalogNormalization: fenced.catalogNormalization,
    d1Import,
    postgresImport: pgImport,
    d1Parity,
    postgresParity,
    authority,
  };
}
