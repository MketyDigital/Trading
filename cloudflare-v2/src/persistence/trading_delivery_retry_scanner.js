import { verifyTradingStorageAuthority } from './trading_storage_authority.js';

/** Read due retries from the selected authority; claiming remains a separate fenced CAS. */
export async function listTradingDeliveryRetries({ authority, postgresDatabase, now, limit = 20, maxAttempts = 5 } = {}) {
  if (!authority) throw new TypeError('Trading storage authority is required');
  const at = new Date(now);
  if (!Number.isFinite(at.getTime())) throw new TypeError('A valid retry scan time is required');
  await verifyTradingStorageAuthority(authority, { postgresDatabase });
  const size = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 20)));
  const attempts = Math.max(1, Math.trunc(Number(maxAttempts) || 5));
  const d1 = authority.kind === 'd1';
  const table = d1 ? 'destination_deliveries' : 'trading_storage.destination_deliveries';
  const sql = `SELECT * FROM ${table}
    WHERE ((status='RETRYABLE' AND next_attempt_at<=${d1 ? '?' : '$1'} AND attempt_count<${d1 ? '?' : '$2'}
      AND (lease_expires_at IS NULL OR lease_expires_at<${d1 ? '?' : '$3'}))
      OR (status='PENDING' AND lease_expires_at<${d1 ? '?' : '$4'}))
    ORDER BY CASE WHEN status='PENDING' THEN lease_expires_at ELSE next_attempt_at END
    LIMIT ${d1 ? '?' : '$5'}`;
  let rows;
  if (d1) {
    const result = await authority.binding.prepare(sql).bind(at.toISOString(), attempts, at.toISOString(), at.toISOString(), size).all();
    rows = result.results || [];
  } else {
    rows = (await postgresDatabase.query(sql, [at.toISOString(), attempts, at.toISOString(), at.toISOString(), size])).rows || [];
  }
  return rows.map(row => {
    const decoded = { ...row };
    for (const field of ['request_payload', 'response_payload']) {
      if (typeof decoded[field] === 'string') {
        try { decoded[field] = JSON.parse(decoded[field]); } catch { decoded[field] = null; }
      }
    }
    return decoded;
  });
}

export async function listTradingBindingRepairs({ authority, postgresDatabase, limit = 50 } = {}) {
  await verifyTradingStorageAuthority(authority, { postgresDatabase });
  const size = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const d1 = authority.kind === 'd1';
  const table = d1 ? 'destination_deliveries' : 'trading_storage.destination_deliveries';
  const sql = `SELECT * FROM ${table} WHERE status='SUCCEEDED' AND failure_class='STATE_BINDING_PENDING' ORDER BY updated_at ASC LIMIT ${d1 ? '?' : '$1'}`;
  const result = d1 ? await authority.binding.prepare(sql).bind(size).all() : await postgresDatabase.query(sql, [size]);
  const rows = d1 ? result.results || [] : result.rows || [];
  return rows.map(row => {
    const decoded={...row};
    for(const field of ['request_payload','response_payload'])if(typeof decoded[field]==='string'){try{decoded[field]=JSON.parse(decoded[field]);}catch{decoded[field]=null;}}
    return decoded;
  });
}
