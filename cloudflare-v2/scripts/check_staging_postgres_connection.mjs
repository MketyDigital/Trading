import { readFile } from 'node:fs/promises';

const IDENTITY_QUERY = `
  SELECT
    current_database() AS database_name,
    current_schema() AS schema_name,
    current_setting('transaction_read_only') AS transaction_read_only,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'trading_storage') AS trading_schema_exists,
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS role_is_superuser,
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = 'trading_owner'), true) AS trading_owner_is_superuser,
    COALESCE((SELECT rolcanlogin FROM pg_roles WHERE rolname = 'trading_owner'), true) AS trading_owner_can_login,
    COALESCE((SELECT rolcreatedb FROM pg_roles WHERE rolname = 'trading_owner'), true) AS trading_owner_can_create_database,
    COALESCE((SELECT rolcreaterole FROM pg_roles WHERE rolname = 'trading_owner'), true) AS trading_owner_can_create_roles,
    COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'trading_owner'), true) AS trading_owner_bypasses_rls,
    COALESCE((SELECT rolinherit FROM pg_roles WHERE rolname = 'trading_owner'), true) AS trading_owner_inherits_roles,
    COALESCE((
      SELECT array_agg(datname ORDER BY datname)
      FROM pg_database
      WHERE datistemplate = false AND datname ~* '(trading|stage|staging|test)'
    ), ARRAY[]::text[]) AS available_trading_database_names
`;

const SCHEMA_TABLES_QUERY = `
  SELECT
    to_regclass('trading_storage.authority_control') IS NOT NULL AS authority_control_exists,
    to_regclass('trading_storage.runtime_controls') IS NOT NULL AS runtime_controls_exists,
    to_regclass('trading_storage.schema_migrations') IS NOT NULL AS migration_ledger_exists
`;

const SCHEMA_SAFETY_QUERY = `
  SELECT
    (SELECT active_authority FROM trading_storage.authority_control WHERE singleton_id = 1) AS active_authority,
    (SELECT writes_fenced FROM trading_storage.authority_control WHERE singleton_id = 1) AS writes_fenced,
    (SELECT COUNT(*)::integer FROM trading_storage.runtime_controls) AS control_count,
    (SELECT COUNT(*)::integer FROM trading_storage.runtime_controls WHERE enabled = false) AS disabled_control_count,
    (SELECT COUNT(*)::integer FROM trading_storage.runtime_controls
       WHERE control_key IN ('broker_execution_enabled', 'live_broker_execution_enabled')) AS execution_control_count,
    (SELECT COUNT(*)::integer FROM trading_storage.runtime_controls
       WHERE control_key IN ('broker_execution_enabled', 'live_broker_execution_enabled') AND enabled = false) AS disabled_execution_control_count,
    (SELECT COALESCE(array_agg(control_key ORDER BY control_key), ARRAY[]::text[])
       FROM trading_storage.runtime_controls WHERE enabled = true) AS enabled_runtime_control_keys,
    (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'trading_storage') AS schema_owner,
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
        )) AS public_definer_execute_count,
    (SELECT COALESCE(array_agg(version ORDER BY version), ARRAY[]::text[])
       FROM trading_storage.schema_migrations) AS migration_versions
`;

function safeIdentifier(value) {
  const identifier = String(value ?? '');
  return /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(identifier) ? identifier : '[redacted]';
}

function safeFailureCode(error) {
  const chain = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    chain.push(current);
    current = current.cause;
  }
  for (const candidate of chain) {
    const code = candidate?.code ?? candidate?.errno;
    if (typeof code === 'string' && /^[A-Z0-9_-]{2,16}$/i.test(code)) return code.toUpperCase();
  }
  const messages = chain.map(candidate => String(candidate?.message || '')).join(' ').toLowerCase();
  if (/certificate|self.signed|unknown ca|unable to verify|issuer certificate/.test(messages)) return 'TLS_CERTIFICATE';
  if (/ssl|tls|handshake/.test(messages)) return 'TLS';
  if (/enotfound|eai_again|could not translate host|name or service not known/.test(messages)) return 'DNS';
  if (/econnrefused|connection refused/.test(messages)) return 'CONNECTION_REFUSED';
  if (/etimedout|timed? ?out|timeout/.test(messages)) return 'TIMEOUT';
  if (/password authentication|authentication failed|no pg_hba/.test(messages)) return 'AUTH_REJECTED';
  if (/connection terminated|server closed|socket/.test(messages)) return 'CONNECTION_LOST';
  return 'UNKNOWN';
}

/** Connect to an explicitly scoped staging URL and prove the target via a read-only transaction. */
export async function checkStagingPostgresConnection({
  connectionString = process.env.TRADING_PG_STAGING_DATABASE_URL,
  expectedDatabaseName = process.env.TRADING_PG_EXPECTED_DATABASE,
  ClientClass,
  caFilePath = process.env.TRADING_PG_CA_FILE,
  caCertificate
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new Error('TRADING_PG_STAGING_DATABASE_URL is required for the staging PostgreSQL probe');
  }

  let stage = 'load trusted Coolify PostgreSQL CA';
  let trustedCa = caCertificate;
  try {
    if (typeof trustedCa !== 'string' || !trustedCa.trim()) {
      if (typeof caFilePath !== 'string' || !caFilePath.trim()) throw new Error('TRADING_PG_CA_FILE is required');
      trustedCa = await readFile(caFilePath, 'utf8');
    }
    const verifiedUrl = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(verifiedUrl.protocol)) throw new Error('PostgreSQL URL required');
    verifiedUrl.searchParams.set('sslmode', 'verify-ca');
    verifiedUrl.searchParams.set('sslrootcert', caFilePath || '/injected/coolify-postgres-ca.crt');
    verifiedUrl.searchParams.set('uselibpqcompat', 'true');
    connectionString = verifiedUrl.toString();
  } catch (error) {
    throw new Error(`Staging PostgreSQL probe failed during ${stage} (code ${safeFailureCode(error)}).`);
  }

  const Client = ClientClass || (await import('pg')).Client;
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    statement_timeout: 10_000
  });
  let connected = false;
  let transactionStarted = false;
  let failure;
  stage = 'connect';

  try {
    await client.connect();
    connected = true;
    stage = 'begin read-only transaction';
    await client.query('BEGIN READ ONLY');
    transactionStarted = true;
    stage = 'read database identity';
    const result = await client.query(IDENTITY_QUERY);
    const identity = result?.rows?.[0];
    if (!identity) throw new Error('Database identity query returned no row');
    let tradingSchemaAudit = null;
    if (identity.trading_schema_exists === true) {
      stage = 'inspect existing Trading schema objects';
      const presenceResult = await client.query(SCHEMA_TABLES_QUERY);
      const presence = presenceResult?.rows?.[0];
      if (!presence) throw new Error('Trading schema object inventory returned no row');
      if (presence.authority_control_exists === true
        && presence.runtime_controls_exists === true
        && presence.migration_ledger_exists === true) {
        stage = 'read existing Trading schema safety state';
        const auditResult = await client.query(SCHEMA_SAFETY_QUERY);
        const audit = auditResult?.rows?.[0];
        if (!audit) throw new Error('Trading schema safety audit returned no row');
        const versions = Array.isArray(audit.migration_versions)
          ? audit.migration_versions.filter((version) => typeof version === 'string' && /^\d{4}$/.test(version))
          : [];
        const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
        tradingSchemaAudit = {
          status: 'complete',
          activeAuthority: audit.active_authority === 'd1' || audit.active_authority === 'postgres'
            ? audit.active_authority
            : 'unknown',
          writesFenced: audit.writes_fenced === true,
          runtimeControlCount: safeCount(audit.control_count),
          disabledRuntimeControlCount: safeCount(audit.disabled_control_count),
          executionControlCount: safeCount(audit.execution_control_count),
          disabledExecutionControlCount: safeCount(audit.disabled_execution_control_count),
          enabledRuntimeControlKeys: Array.isArray(audit.enabled_runtime_control_keys)
            ? audit.enabled_runtime_control_keys.map(safeIdentifier).filter((key) => key !== '[redacted]')
            : [],
          schemaOwner: safeIdentifier(audit.schema_owner),
          unsafeDefinerOwnerCount: safeCount(audit.unsafe_definer_owner_count),
          publicDefinerExecuteCount: safeCount(audit.public_definer_execute_count),
          migrationVersions: versions
        };
      } else {
        tradingSchemaAudit = {
          status: 'incomplete',
          authorityControlExists: presence.authority_control_exists === true,
          runtimeControlsExist: presence.runtime_controls_exists === true,
          migrationLedgerExists: presence.migration_ledger_exists === true
        };
      }
    }
    if (identity.transaction_read_only !== 'on') {
      throw new Error('Staging PostgreSQL session must be read-only');
    }
    if (expectedDatabaseName && identity.database_name !== expectedDatabaseName) {
      throw new Error('PostgreSQL probe found an unexpected database identity');
    }

    stage = 'rollback read-only transaction';
    await client.query('ROLLBACK');
    transactionStarted = false;
    return {
      databaseName: safeIdentifier(identity.database_name),
      schemaName: safeIdentifier(identity.schema_name),
      transactionReadOnly: true,
      tradingSchemaExists: identity.trading_schema_exists === true,
      tradingSchemaAudit,
      roleIsSuperuser: identity.role_is_superuser === true,
      tradingOwnerRoleIsRestricted: identity.trading_owner_is_superuser === false
        && identity.trading_owner_can_login === false
        && identity.trading_owner_can_create_database === false
        && identity.trading_owner_can_create_roles === false
        && identity.trading_owner_bypasses_rls === false
        && identity.trading_owner_inherits_roles === false,
      availableTradingDatabaseNames: Array.isArray(identity.available_trading_database_names)
        ? identity.available_trading_database_names.map(safeIdentifier)
        : []
    };
  } catch (error) {
    failure = error;
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    }
    if (error?.message === 'Staging PostgreSQL session must be read-only'
      || error?.message === 'PostgreSQL probe found an unexpected database identity') throw error;
    const code = safeFailureCode(error);
    throw new Error(`Staging PostgreSQL probe failed during ${stage} (code ${code}).`);
  } finally {
    if (connected) {
      try { await client.end(); } catch {
        if (!failure) throw new Error('Staging PostgreSQL probe could not close its session cleanly');
      }
    }
  }
}
