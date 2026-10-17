const AUTHORITY_KEYS = new Set(['d1', 'postgres']);

/**
 * Resolve the one database allowed to serve authoritative trading reads/writes.
 * There is deliberately no runtime fallback: a missing or unhealthy primary
 * must stop the operation instead of silently changing the write authority.
 */
export function resolveTradingStorageAuthority(env = {}) {
  const configured = String(env.TRADING_STORAGE_AUTHORITY || 'd1').trim().toLowerCase();
  const authorityEpoch = assertAuthorityEpoch(env.TRADING_STORAGE_AUTHORITY_EPOCH ?? 1);
  if (!AUTHORITY_KEYS.has(configured)) {
    throw new Error(`Unsupported TRADING_STORAGE_AUTHORITY: ${configured || '(empty)'}`);
  }

  if (configured === 'd1') {
    if (!env.DB || typeof env.DB.prepare !== 'function') {
      throw new Error('D1 binding DB is required for D1 trading storage authority');
    }
    return Object.freeze({ kind: 'd1', binding: env.DB, authorityEpoch });
  }

  if (!env.TRADING_PG || typeof env.TRADING_PG.connectionString !== 'string' || !env.TRADING_PG.connectionString.trim()) {
    throw new Error('TRADING_PG Hyperdrive binding is required for PostgreSQL trading storage authority');
  }
  return Object.freeze({ kind: 'postgres', binding: env.TRADING_PG, authorityEpoch });
}

export function assertAuthorityEpoch(value) {
  const epoch = Number(value);
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('Trading storage authority epoch must be a positive safe integer');
  return epoch;
}

/** Verify that this deployment is still the single unfenced writer. */
export async function verifyTradingStorageAuthority(authority, { postgresDatabase } = {}) {
  if (!authority || !['d1', 'postgres'].includes(authority.kind)) throw new Error('A resolved trading storage authority is required');
  const expectedEpoch = assertAuthorityEpoch(authority.authorityEpoch);
  let row;
  if (authority.kind === 'd1') {
    row = await authority.binding.prepare(`
      SELECT active_authority AS activeAuthority, authority_epoch AS authorityEpoch, writes_fenced AS writesFenced
      FROM trading_storage_control WHERE singleton_id = 1
    `).first();
  } else {
    if (!postgresDatabase || typeof postgresDatabase.query !== 'function') throw new Error('PostgreSQL trading authority requires a connected database session');
    const result = await postgresDatabase.query(`
      SELECT active_authority AS "activeAuthority", authority_epoch AS "authorityEpoch", writes_fenced AS "writesFenced"
      FROM trading_storage.authority_control WHERE singleton_id = 1
    `);
    row = result.rows?.[0] || null;
  }
  if (!row) throw new Error('Trading storage authority control row is missing');
  if (row.activeAuthority !== authority.kind) throw new Error('Trading storage authority is fenced by a different active authority');
  if (Number(row.authorityEpoch) !== expectedEpoch) throw new Error('Trading storage authority epoch does not match this Worker deployment');
  if (row.writesFenced === true || row.writesFenced === 1 || row.writesFenced === '1') throw new Error('Trading storage authority is write-fenced');
  if (!(row.writesFenced === false || row.writesFenced === 0 || row.writesFenced === '0')) throw new Error('Trading storage authority fence state is invalid');
  return { authority: authority.kind, authorityEpoch: expectedEpoch, writable: true };
}
