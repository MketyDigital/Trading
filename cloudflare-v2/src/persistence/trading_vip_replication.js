import { assertAuthorityEpoch } from './trading_storage_authority.js';

const MEMBER_FIELDS = new Set(['workspace_id', 'telegram_id', 'username', 'first_name', 'status', 'trial_used', 'subscription_tier', 'expires_at', 'invite_link', 'created_at', 'updated_at']);
const DEPOSIT_FIELDS = new Set(['workspace_id', 'telegram_id', 'username', 'amount', 'plan_requested', 'receipt_photo_file_id', 'status', 'created_at']);

export async function applyTradingVIPReplicationEvent(event, { targetAuthority, postgresDatabase } = {}) {
  const expected = event?.direction === 'd1_to_postgres' ? 'postgres' : event?.direction === 'postgres_to_d1' ? 'd1' : null;
  if (expected !== targetAuthority?.kind) throw new Error('Replication target authority does not match event direction');
  const epoch = assertAuthorityEpoch(event.authorityEpoch);
  if (assertAuthorityEpoch(targetAuthority.authorityEpoch) !== epoch) throw new Error('Replication event authority epoch does not match target runtime epoch');
  const isMember = event.entityType === 'trading_vip_member';
  const isDeposit = event.entityType === 'trading_vip_deposit';
  if ((!isMember && !isDeposit) || event.operation !== 'upsert') throw new Error('Unsupported VIP replication event');
  const row = event.payload?.row;
  const id = String(event.entityId || '');
  const fields = isMember ? MEMBER_FIELDS : DEPOSIT_FIELDS;
  const table = targetAuthority.kind === 'd1' ? (isMember ? 'vip_members' : 'bank_deposits') : (isMember ? 'trading_storage.vip_members' : 'trading_storage.bank_deposits');
  if (!row || String(row.id) !== id || !row.workspace_id || row.telegram_id == null || (isMember && !row.expires_at) || row.tg_bot_token !== undefined) throw new Error('Invalid VIP replication row');
  for (const key of Object.keys(row)) if (key !== 'id' && !fields.has(key)) throw new Error(`Unsupported VIP replication field: ${key}`);
  const d1 = targetAuthority.kind === 'd1';
  const source = event.direction === 'd1_to_postgres' ? 'd1' : 'postgres';
  const cols = Object.keys(row);
  const values = cols.map((key) => key === 'trial_used' && d1 ? Number(Boolean(row[key])) : row[key]);
  if (d1) {
    const updates = cols.filter((key) => !['id', 'workspace_id', 'telegram_id', 'created_at'].includes(key)).map((key) => `${key}=excluded.${key}`).join(',');
    const conflict = isMember ? ` ON CONFLICT(workspace_id,telegram_id) DO UPDATE SET ${updates}` : ` ON CONFLICT(id) DO UPDATE SET ${cols.filter((key) => !['id', 'workspace_id', 'created_at'].includes(key)).map((key) => `${key}=excluded.${key}`).join(',')}`;
    const result = await targetAuthority.binding.prepare(`INSERT INTO ${table}(${cols.join(',')}) SELECT ${cols.map(() => '?').join(',')} WHERE EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority=? AND authority_epoch=?)${conflict}`).bind(...values, source, epoch).run();
    if (Number(result?.meta?.changes || 0) !== 1) {
      const existing = await targetAuthority.binding.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first();
      if (!existing) throw new Error('Passive D1 replica rejected VIP event');
    }
    return { applied: true, entityId: id };
  }
  if (!postgresDatabase) throw new TypeError('Connected PostgreSQL database is required');
  return postgresDatabase.transaction(async (query) => {
    const control = await query('SELECT active_authority,authority_epoch FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE');
    const current = control.rows?.[0];
    if (!current || current.active_authority !== source || Number(current.authority_epoch) !== epoch) throw new Error('Passive PostgreSQL replica rejected VIP event');
    const updates = cols.filter((key) => !['id', 'workspace_id', 'telegram_id', 'created_at'].includes(key)).map((key) => `${key}=EXCLUDED.${key}`).join(',');
    const conflict = isMember ? ` ON CONFLICT(workspace_id,telegram_id) DO UPDATE SET ${updates}` : ` ON CONFLICT(id) DO UPDATE SET ${cols.filter((key) => !['id', 'workspace_id', 'created_at'].includes(key)).map((key) => `${key}=EXCLUDED.${key}`).join(',')}`;
    const params = values;
    const casts = cols.map((key, index) => `$${index + 1}${key === 'trial_used' ? '::boolean' : ''}`).join(',');
    await query(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${casts})${conflict}`, params);
    return { applied: true, entityId: id };
  });
}
