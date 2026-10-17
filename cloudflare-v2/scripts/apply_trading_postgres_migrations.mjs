import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_NAMES = [
  '0001_trading_storage_replication_authority.sql',
  '0002_trading_domain_schema.sql',
  '0003_trading_replication_health.sql'
];
const MIGRATION_LOCK = 'mkety.trading_storage.schema_migrations';

function safeCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_-]{2,16}$/i.test(error.code)
    ? error.code.toUpperCase()
    : 'UNKNOWN';
}

function migrationErrorLocation(error, sql) {
  const position = Number(error?.position);
  if (!Number.isSafeInteger(position) || position < 1 || typeof sql !== 'string') return '';
  const line = Buffer.from(sql, 'utf8').subarray(0, position - 1).toString('utf8').split('\n').length;
  return ` at line ${line}`;
}

function safePermissionTarget(error) {
  if (safeCode(error) !== '42501') return '';
  const match = String(error?.message || '').match(/permission denied for (schema|table|sequence|function|language|database|type|extension) ([A-Za-z0-9_.\"-]+)/i);
  return match ? `permission denied for ${match[1]} ${match[2]}` : '';
}

async function loadMigrations(directory = join(here, '../db/postgres-migrations')) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  if (names.length !== MIGRATION_NAMES.length || names.some((name, index) => name !== MIGRATION_NAMES[index])) {
    throw new Error('PostgreSQL migration set does not match the reviewed allowlist');
  }
  return Promise.all(names.map(async (name) => ({
    name,
    version: name.slice(0, 4),
    sql: await readFile(join(directory, name), 'utf8')
  })));
}

function checksumsFor(migrations) {
  return migrations.map(({ name, version = name.slice(0, 4), sql }) => ({
    name,
    version,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex')
  }));
}

/** Apply the reviewed additive schema once, transactionally, to the existing mkety database. */
export async function applyTradingPostgresMigrations({
  connectionString = process.env.TRADING_PG_STAGING_DATABASE_URL,
  expectedDatabaseName = process.env.TRADING_PG_EXPECTED_DATABASE || 'mkety',
  confirmation = process.env.TRADING_PG_SCHEMA_MIGRATION_CONFIRM,
  caFilePath = process.env.TRADING_PG_CA_FILE,
  caCertificate,
  ClientClass,
  migrations: injectedMigrations
} = {}) {
  if (!connectionString) throw new Error('Existing Coolify PostgreSQL connection URL is required');
  if (expectedDatabaseName !== 'mkety') throw new Error('PostgreSQL installer only permits the existing mkety database');
  if (confirmation !== 'APPLY_TRADING_STORAGE_SCHEMA') throw new Error('Explicit PostgreSQL schema migration confirmation is required');

  const ca = caCertificate || (caFilePath ? await readFile(caFilePath, 'utf8') : '');
  if (!ca.trim()) throw new Error('Trusted Coolify PostgreSQL CA is required');
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL URL is required');
  if (decodeURIComponent(url.pathname.replace(/^\//, '')) !== expectedDatabaseName) {
    throw new Error('PostgreSQL URL does not target the expected database');
  }
  url.searchParams.set('sslmode', 'verify-ca');
  url.searchParams.set('sslrootcert', caFilePath || '/injected/coolify-postgres-ca.crt');
  url.searchParams.set('uselibpqcompat', 'true');

  const migrationSet = checksumsFor(injectedMigrations || await loadMigrations());
  if (migrationSet.length !== MIGRATION_NAMES.length
    || migrationSet.some(({ name }, index) => name !== MIGRATION_NAMES[index])) {
    throw new Error('PostgreSQL migration set does not match the reviewed allowlist');
  }

  const Client = ClientClass || (await import('pg')).Client;
  const client = new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10_000,
    query_timeout: 120_000,
    statement_timeout: 120_000
  });
  let connected = false;
  let inTransaction = false;
  let stage = 'connect';
  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN');
    inTransaction = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION_LOCK]);

    stage = 'verify existing database identity';
    const identityResult = await client.query(`
      SELECT current_database() AS database_name,
             current_setting('transaction_read_only') AS transaction_read_only,
             EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'trading_storage') AS trading_schema_exists,
             COALESCE((SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'trading_storage'), '') AS schema_owner,
             EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trading_owner') AS owner_role_exists,
             COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS current_role_is_superuser
    `);
    const identity = identityResult?.rows?.[0];
    if (!identity || identity.database_name !== expectedDatabaseName) {
      throw new Error('PostgreSQL connection is not the expected database');
    }
    if (identity.transaction_read_only !== 'off') throw new Error('PostgreSQL migration connection is read-only');
    if (!identity.owner_role_exists) {
      if (identity.current_role_is_superuser !== true) {
        throw new Error('Current database role cannot provision trading_owner');
      }
      stage = 'create restricted Trading owner role';
      await client.query('CREATE ROLE trading_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT');
    }

    stage = 'verify restricted Trading owner role';
    const ownerResult = await client.query(`
      SELECT rolsuper AS owner_is_superuser,
             rolcanlogin AS owner_can_login,
             rolcreatedb AS owner_can_create_database,
             rolcreaterole AS owner_can_create_roles,
             rolbypassrls AS owner_bypasses_rls,
             rolinherit AS owner_inherits_roles
        FROM pg_roles
       WHERE rolname = 'trading_owner'
    `);
    const owner = ownerResult?.rows?.[0];
    if (!owner || owner.owner_is_superuser !== false || owner.owner_can_login !== false
      || owner.owner_can_create_database !== false || owner.owner_can_create_roles !== false
      || owner.owner_bypasses_rls !== false || owner.owner_inherits_roles !== false) {
      throw new Error('Trading owner role has unsafe privileges');
    }
    const membership = await client.query("SELECT pg_has_role(current_user, 'trading_owner', 'MEMBER') AS is_member");
    if (identity.current_role_is_superuser !== true && membership?.rows?.[0]?.is_member !== true) {
      throw new Error('Current database role cannot assume trading_owner');
    }

    if (identity.trading_schema_exists) {
      if (identity.schema_owner !== 'trading_owner') throw new Error('Existing trading_storage schema has an unexpected owner');
      stage = 'verify migration ledger';
      const ledgerPresence = await client.query("SELECT to_regclass('trading_storage.schema_migrations') IS NOT NULL AS ledger_exists");
      if (ledgerPresence?.rows?.[0]?.ledger_exists !== true) {
        throw new Error('Untracked trading_storage schema already exists');
      }
      const ledgerResult = await client.query('SELECT version, checksum FROM trading_storage.schema_migrations ORDER BY version');
      const applied = ledgerResult?.rows || [];
      const exact = applied.length === migrationSet.length && migrationSet.every((migration, index) => (
        applied[index]?.version === migration.version && applied[index]?.checksum === migration.checksum
      ));
      if (!exact) throw new Error('Existing trading_storage migration ledger does not match reviewed files');
      stage = 'verify fenced authority and function privileges';
      await verifySchemaSafety(client);
      await client.query('COMMIT');
      inTransaction = false;
      return { databaseName: expectedDatabaseName, schemaName: 'trading_storage', applied: [], alreadyApplied: true };
    }

    stage = 'apply reviewed schema migrations';
    await client.query('CREATE SCHEMA trading_storage AUTHORIZATION trading_owner');
    await client.query('SET LOCAL ROLE trading_owner');
    const effectiveRole = await client.query('SELECT current_user AS current_role');
    if (effectiveRole?.rows?.[0]?.current_role !== 'trading_owner') {
      throw new Error('PostgreSQL migration did not switch to the restricted Trading owner');
    }
    for (let index = 0; index < migrationSet.length; index += 1) {
      const migration = migrationSet[index];
      stage = `apply migration ${migration.name}`;
      await client.query(migration.sql);
      if (index === 0) {
        await client.query('CREATE TABLE trading_storage.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      }
      await client.query('INSERT INTO trading_storage.schema_migrations (version, checksum) VALUES ($1, $2)', [migration.version, migration.checksum]);
    }

    stage = 'verify fenced authority and function privileges';
    await verifySchemaSafety(client);

    await client.query('COMMIT');
    inTransaction = false;
    return { databaseName: expectedDatabaseName, schemaName: 'trading_storage', applied: migrationSet.map(({ name }) => name), alreadyApplied: false };
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch { /* keep the migration failure */ }
    }
    const safeMessages = new Set([
      'PostgreSQL connection is not the expected database',
      'PostgreSQL migration connection is read-only',
      'Current database role cannot provision trading_owner',
      'Trading owner role has unsafe privileges',
      'Current database role cannot assume trading_owner',
      'Existing trading_storage schema has an unexpected owner',
      'PostgreSQL migration did not switch to the restricted Trading owner',
      'Untracked trading_storage schema already exists',
      'Existing trading_storage migration ledger does not match reviewed files',
      'PostgreSQL schema did not retain the required restricted, fenced/off defaults'
    ]);
    if (safeMessages.has(error?.message)) throw error;
    const migration = migrationSet.find(({ name }) => stage === `apply migration ${name}`);
    const location = migration ? migrationErrorLocation(error, migration.sql) : '';
    const permissionTarget = safePermissionTarget(error);
    const details = [location.trim(), permissionTarget].filter(Boolean).join('; ');
    throw new Error(`PostgreSQL schema migration failed during ${stage}${details ? ` (${details})` : ''} (code ${safeCode(error)}).`);
  } finally {
    if (connected) {
      try { await client.end(); } catch { /* connection cleanup must not mask migration result */ }
    }
  }
}

async function verifySchemaSafety(client) {
  const verification = await client.query(`
    SELECT authority.active_authority,
           authority.writes_fenced,
           (SELECT COUNT(*)::integer FROM trading_storage.runtime_controls) AS control_count,
           (SELECT COUNT(*)::integer FROM trading_storage.runtime_controls WHERE enabled = false) AS disabled_control_count,
           pg_get_userbyid(namespace.nspowner) AS schema_owner,
           (SELECT COUNT(*)::integer
              FROM pg_proc AS p
              JOIN pg_namespace AS function_namespace ON function_namespace.oid = p.pronamespace
             WHERE function_namespace.nspname = 'trading_storage'
               AND p.prosecdef
               AND pg_get_userbyid(p.proowner) <> 'trading_owner') AS unsafe_definer_owner_count,
           (SELECT COUNT(*)::integer
              FROM pg_proc AS p
              JOIN pg_namespace AS function_namespace ON function_namespace.oid = p.pronamespace
             WHERE function_namespace.nspname = 'trading_storage'
               AND p.prosecdef
               AND EXISTS (
                 SELECT 1
                   FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl_entry
                  WHERE acl_entry.grantee = 0 AND acl_entry.privilege_type = 'EXECUTE'
               )) AS public_definer_execute_count
      FROM trading_storage.authority_control AS authority
      JOIN pg_namespace AS namespace ON namespace.nspname = 'trading_storage'
     WHERE authority.singleton_id = 1
  `);
  const defaults = verification?.rows?.[0];
  if (defaults?.active_authority !== 'd1' || defaults.writes_fenced !== true
    || defaults.control_count !== 3 || defaults.disabled_control_count !== 3
    || defaults.schema_owner !== 'trading_owner' || defaults.unsafe_definer_owner_count !== 0
    || defaults.public_definer_execute_count !== 0) {
    throw new Error('PostgreSQL schema did not retain the required restricted, fenced/off defaults');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await applyTradingPostgresMigrations();
    console.log(`Trading PostgreSQL schema migration complete: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
