import { readFile } from 'node:fs/promises';

const IDENTITY_QUERY = `
  SELECT
    current_database() AS database_name,
    current_schema() AS schema_name,
    current_setting('transaction_read_only') AS transaction_read_only,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'trading_storage') AS trading_schema_exists,
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS role_is_superuser,
    COALESCE((
      SELECT array_agg(datname ORDER BY datname)
      FROM pg_database
      WHERE datistemplate = false AND datname ~* '(trading|stage|staging|test)'
    ), ARRAY[]::text[]) AS available_trading_database_names
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
    if (identity.transaction_read_only !== 'on') {
      throw new Error('Staging PostgreSQL session must be read-only');
    }

    stage = 'rollback read-only transaction';
    await client.query('ROLLBACK');
    transactionStarted = false;
    return {
      databaseName: safeIdentifier(identity.database_name),
      schemaName: safeIdentifier(identity.schema_name),
      transactionReadOnly: true,
      tradingSchemaExists: identity.trading_schema_exists === true,
      roleIsSuperuser: identity.role_is_superuser === true,
      availableTradingDatabaseNames: Array.isArray(identity.available_trading_database_names)
        ? identity.available_trading_database_names.map(safeIdentifier)
        : []
    };
  } catch (error) {
    failure = error;
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    }
    if (error?.message === 'Staging PostgreSQL session must be read-only') throw error;
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
