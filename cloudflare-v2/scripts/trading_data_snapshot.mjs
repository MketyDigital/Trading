import { createHash, createHmac } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve, sep } from 'node:path';
import { encryptSecret, decryptSecret } from '../src/security/secret_box.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(here, '../..');
const SNAPSHOT_SCHEMA_PATH = resolve(REPOSITORY_ROOT, 'docs/supabase-trading-schema-snapshot-2026-10-17.json');
const EXPECTED_PROJECT_REF = 'vdblajgxrfndjesoyayy';
const FORMAT = 'mkety-trading-data-snapshot-v1';

function safeProjectRef(value) {
  const ref = String(value || '').trim();
  if (ref !== EXPECTED_PROJECT_REF) throw new Error('Snapshot source is not the expected Supabase project');
  return ref;
}

export function validateTradingSnapshotRequest({ freezeEvidence, sourceProjectRef, pageSize = 200 } = {}) {
  if (!/^source-freeze:[A-Z0-9][A-Z0-9-]{5,79}$/.test(String(freezeEvidence || ''))) {
    throw new Error('Explicit source-freeze evidence is required');
  }
  const projectRef = safeProjectRef(sourceProjectRef);
  const size = Number(pageSize);
  if (!Number.isSafeInteger(size) || size < 1 || size > 500) throw new Error('Snapshot page size must be between 1 and 500');
  return { freezeEvidence: String(freezeEvidence), sourceProjectRef: projectRef, pageSize: size };
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

async function loadTableInventory() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_SCHEMA_PATH, 'utf8'));
  const inventory = snapshot.tables.map((table) => ({ name: table.name, primaryKeys: table.primaryKeys }));
  if (!inventory.length || inventory.some((table) => !table.name || !table.primaryKeys?.length)) {
    throw new Error('Reviewed Supabase Trading table allowlist is incomplete');
  }
  return inventory;
}

async function fetchTableRows(client, table, pageSize) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = client.from(table.name).select('*');
    for (const key of table.primaryKeys) query = query.order(key, { ascending: true });
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      const code = /^[A-Z0-9_-]{2,16}$/i.test(String(error.code || '')) ? String(error.code).toUpperCase() : 'UNKNOWN';
      throw new Error(`Supabase snapshot read failed for ${table.name} (${code})`);
    }
    if (!Array.isArray(data)) throw new Error(`Supabase snapshot returned invalid rows for ${table.name}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
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

/** Export only while the operator has paused source writes and provides a change/incident reference. */
export async function exportTradingDataSnapshot({
  client,
  masterKey,
  freezeEvidence,
  sourceProjectRef,
  outputPath,
  pageSize = 200,
  clock = () => new Date()
} = {}) {
  const request = validateTradingSnapshotRequest({ freezeEvidence, sourceProjectRef, pageSize });
  if (!client?.from) throw new Error('Supabase snapshot client is required');
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required');
  if (!outputPath) throw new Error('Encrypted snapshot output path is required');
  const targetPath = await assertOutsideRepository(outputPath);
  const inventory = await loadTableInventory();

  const firstRead = {};
  for (const table of inventory) firstRead[table.name] = await fetchTableRows(client, table, request.pageSize);
  const sourceManifest = tableManifest(firstRead, inventory, masterKey);
  const prepared = await prepareTradingSnapshotRows(firstRead, { masterKey });
  const manifest = tableManifest(prepared, inventory, masterKey);

  // A second full read catches concurrent writes that counts alone would miss.
  // Freeze evidence is still mandatory: two equal passes cannot prove an atomic snapshot without it.
  for (const table of inventory) {
    const currentRows = await fetchTableRows(client, table, request.pageSize);
    const currentManifest = tableManifest({ [table.name]: currentRows }, [table], masterKey);
    const expected = sourceManifest.find((entry) => entry.name === table.name);
    if (currentManifest[0].rowCount !== expected.rowCount || currentManifest[0].sha256 !== expected.sha256) {
      throw new Error(`Source changed during snapshot export at table ${table.name}; discard and restart after refreezing`);
    }
  }

  const artifact = {
    format: FORMAT,
    sourceProjectRef: request.sourceProjectRef,
    freezeEvidence: request.freezeEvidence,
    capturedAt: clock().toISOString(),
    tableManifest: manifest.map(({ name, primaryKeys, rowCount, sha256 }) => ({ name, primaryKeys, rowCount, sha256 })),
    payloadCiphertext: await encryptSecret(JSON.stringify(prepared), masterKey)
  };
  await writeFile(targetPath, `${JSON.stringify(artifact)}\n`, { mode: 0o600, flag: 'wx' });
  return {
    format: artifact.format,
    outputPath: targetPath,
    sourceProjectRef: artifact.sourceProjectRef,
    capturedAt: artifact.capturedAt,
    tableManifest: artifact.tableManifest
  };
}

export async function readTradingDataSnapshot({ artifactPath, masterKey } = {}) {
  if (!artifactPath) throw new Error('Encrypted snapshot path is required');
  if (!masterKey) throw new Error('TRADING_MASTER_KEY is required');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  if (artifact?.format !== FORMAT) throw new Error('Trading data snapshot format is unsupported');
  safeProjectRef(artifact.sourceProjectRef);
  validateTradingSnapshotRequest({
    freezeEvidence: artifact.freezeEvidence,
    sourceProjectRef: artifact.sourceProjectRef,
    pageSize: 1
  });
  if (!Array.isArray(artifact.tableManifest)) throw new Error('Trading data snapshot manifest is invalid');
  const rowsByTable = JSON.parse(await decryptSecret(artifact.payloadCiphertext, masterKey));
  const inventory = await loadTableInventory();
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
  return { sourceProjectRef: artifact.sourceProjectRef, freezeEvidence: artifact.freezeEvidence, capturedAt: artifact.capturedAt, tableManifest: expectedManifest, rowsByTable };
}

async function main() {
  const sourceProjectRef = process.env.TRADING_MIGRATION_SOURCE_PROJECT_REF;
  const outputPath = process.env.TRADING_MIGRATION_SNAPSHOT_PATH;
  const masterKey = process.env.TRADING_MASTER_KEY;
  const freezeEvidence = process.env.TRADING_MIGRATION_FREEZE_EVIDENCE;
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceRole) throw new Error('Supabase migration read credentials are required');
  const configuredHost = new URL(url).hostname.toLowerCase();
  if (configuredHost !== `${EXPECTED_PROJECT_REF}.supabase.co`) {
    throw new Error('SUPABASE_URL does not match the pinned Trading source project');
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await exportTradingDataSnapshot({
    client,
    masterKey,
    freezeEvidence,
    sourceProjectRef,
    outputPath,
    pageSize: Number(process.env.TRADING_MIGRATION_PAGE_SIZE || 200)
  });
  for (const table of result.tableManifest) {
    process.stdout.write(`${table.name}\t${table.rowCount}\t${table.sha256}\n`);
  }
  process.stdout.write(`encrypted_snapshot_written\t${result.capturedAt}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message || 'Trading data snapshot failed'}\n`);
    process.exitCode = 1;
  });
}
