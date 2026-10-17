const IDENTITY_QUERY = `
  SELECT
    current_database() AS database_name,
    current_schema() AS schema_name,
    current_setting('transaction_read_only') AS transaction_read_only,
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'trading_storage') AS trading_schema_exists,
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS role_is_superuser
`;

function safeIdentifier(value) {
  const identifier = String(value ?? '');
  return /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(identifier) ? identifier : '[redacted]';
}

/** Connect to an explicitly scoped staging URL and prove the target via a read-only transaction. */
export async function checkStagingPostgresConnection({
  connectionString = process.env.TRADING_PG_STAGING_DATABASE_URL,
  ClientClass
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new Error('TRADING_PG_STAGING_DATABASE_URL is required for the staging PostgreSQL probe');
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

  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN READ ONLY');
    transactionStarted = true;
    const result = await client.query(IDENTITY_QUERY);
    const identity = result?.rows?.[0];
    if (!identity) throw new Error('Database identity query returned no row');
    if (identity.transaction_read_only !== 'on') {
      throw new Error('Staging PostgreSQL session must be read-only');
    }

    await client.query('ROLLBACK');
    transactionStarted = false;
    return {
      databaseName: safeIdentifier(identity.database_name),
      schemaName: safeIdentifier(identity.schema_name),
      transactionReadOnly: true,
      tradingSchemaExists: identity.trading_schema_exists === true,
      roleIsSuperuser: identity.role_is_superuser === true
    };
  } catch (error) {
    failure = error;
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    }
    if (error?.message === 'Staging PostgreSQL session must be read-only') throw error;
    throw new Error('Staging PostgreSQL connection probe failed; verify staging network access and secret configuration.');
  } finally {
    if (connected) {
      try { await client.end(); } catch {
        if (!failure) throw new Error('Staging PostgreSQL probe could not close its session cleanly');
      }
    }
  }
}
