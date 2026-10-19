import { assertAuthorityEpoch } from './trading_storage_authority.js';

const FIELDS = new Set(['workspace_id', 'follower_account_id', 'parent_account_id', 'enabled', 'lot_multiplier', 'fixed_lot', 'last_source_version', 'last_state_fingerprint', 'created_at', 'updated_at']);
function validate(event, target) {
  const expected = event?.direction === 'd1_to_postgres' ? 'postgres' : event?.direction === 'postgres_to_d1' ? 'd1' : null;
  if (expected !== target) throw new Error('Replication target authority does not match event direction');
  const epoch = assertAuthorityEpoch(event.authorityEpoch);
  if (event.entityType !== 'trading_account_follower' || !['upsert', 'delete'].includes(event.operation)) throw new Error('Unsupported account follower replication event');
  const payload = event.payload || {};
  const mutation = payload._mutation;
  const row = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== '_mutation'));
  if (!event.entityId || !row.workspace_id || !row.follower_account_id || !['insert', 'update', 'delete'].includes(mutation)) throw new Error('Invalid account follower replication payload');
  for (const key of Object.keys(row)) if (!FIELDS.has(key)) throw new Error(`Unsupported account follower field: ${key}`);
  return { epoch, mutation, id: String(event.entityId), row };
}
function encode(row, d1) { return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'boolean' && d1 ? Number(value) : value])); }

export async function applyTradingAccountFollowerReplicationEvent(event, { targetAuthority, postgresDatabase } = {}) {
  if (!targetAuthority || !['d1', 'postgres'].includes(targetAuthority.kind)) throw new TypeError('Resolved replication target authority is required');
  const item = validate(event, targetAuthority.kind);
  if (assertAuthorityEpoch(targetAuthority.authorityEpoch) !== item.epoch) throw new Error('Replication event authority epoch does not match target runtime epoch');
  const source = event.direction === 'd1_to_postgres' ? 'd1' : 'postgres';
  const row = encode(item.row, targetAuthority.kind === 'd1');
  const table = targetAuthority.kind === 'd1' ? 'trading_account_followers' : 'trading_storage.trading_account_followers';
  if (targetAuthority.kind === 'd1') {
    const db = targetAuthority.binding;
    const guard = `EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority=? AND authority_epoch=?)`;
    let statement;
    if (item.mutation === 'delete') statement = db.prepare(`DELETE FROM ${table} WHERE id=? AND workspace_id=? AND ${guard}`).bind(item.id, row.workspace_id, source, item.epoch);
    else if (item.mutation === 'insert') { const cols = Object.keys(row); statement = db.prepare(`INSERT INTO ${table}(id,${cols.join(',')}) SELECT ?,${cols.map(() => '?').join(',')} WHERE ${guard} ON CONFLICT(id) DO NOTHING`).bind(item.id, ...cols.map((key) => row[key]), source, item.epoch); }
    else { const cols = Object.keys(row).filter((key) => key !== 'workspace_id'); statement = db.prepare(`UPDATE ${table} SET ${cols.map((key) => `${key}=?`).join(',')} WHERE id=? AND workspace_id=? AND ${guard}`).bind(...cols.map((key) => row[key]), item.id, row.workspace_id, source, item.epoch); }
    const result = await db.batch([statement]);
    if (item.mutation === 'update' && Number(result?.[0]?.meta?.changes || 0) !== 1) throw new Error('Passive D1 replica could not update account follower');
    return { applied: true, entityId: event.entityId };
  }
  if (!postgresDatabase) throw new TypeError('Connected PostgreSQL database is required for replication target');
  return postgresDatabase.transaction(async (query) => {
    const control = await query(`SELECT active_authority,authority_epoch FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);
    const current = control.rows?.[0];
    if (!current || current.active_authority !== source || Number(current.authority_epoch) !== item.epoch) throw new Error('Passive PostgreSQL replica rejected account follower event');
    const cols = Object.keys(row);
    if (item.mutation === 'delete') await query(`DELETE FROM ${table} WHERE id=$1 AND workspace_id=$2`, [item.id, row.workspace_id]);
    else if (item.mutation === 'insert') await query(`INSERT INTO ${table}(id,${cols.join(',')}) VALUES($1,${cols.map((key, index) => `$${index + 2}${['lot_multiplier', 'fixed_lot'].includes(key) ? '::numeric' : ''}`).join(',')}) ON CONFLICT(id) DO NOTHING`, [item.id, ...cols.map((key) => row[key])]);
    else { const fields = cols.filter((key) => key !== 'workspace_id'); await query(`UPDATE ${table} SET ${fields.map((key, index) => `${key}=$${index + 1}${['lot_multiplier', 'fixed_lot'].includes(key) ? '::numeric' : ''}`).join(',')} WHERE id=$${fields.length + 1} AND workspace_id=$${fields.length + 2}`, [...fields.map((key) => row[key]), item.id, row.workspace_id]); }
    return { applied: true, entityId: event.entityId };
  });
}
