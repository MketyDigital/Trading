import { verifyTradingStorageAuthority } from './trading_storage_authority.js';
import { prepareD1ReplicationAppendStatements } from './d1_replication_journal.js';
import { appendPostgresReplicationEventInTransaction } from './postgres_replication_journal.js';

const MEMBER_FIELDS = new Set(['workspace_id', 'telegram_id', 'username', 'first_name', 'status', 'trial_used', 'subscription_tier', 'expires_at', 'invite_link', 'created_at', 'updated_at']);
const DEPOSIT_FIELDS = new Set(['workspace_id', 'telegram_id', 'username', 'amount', 'plan_requested', 'receipt_photo_file_id', 'status', 'created_at']);
const asMember = (row) => row && ({ ...row, trial_used: Boolean(row.trial_used) });
async function stableMemberId(workspaceId, telegramId) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`vip-member:${workspaceId}:${telegramId}`)));
  const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('').split('');
  hex[12] = '5'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function createTradingVIPRepository({ authority, postgresDatabase, idFactory = () => globalThis.crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  if (!authority || !['d1', 'postgres'].includes(authority.kind)) throw new TypeError('Resolved D1 or PostgreSQL authority is required');
  if (authority.kind === 'postgres' && !postgresDatabase) throw new TypeError('Connected PostgreSQL database is required');
  const d1 = authority.kind === 'd1';
  const members = d1 ? 'vip_members' : 'trading_storage.vip_members';
  const deposits = d1 ? 'bank_deposits' : 'trading_storage.bank_deposits';
  const marker = d1 ? '?' : '$1';
  async function query(sql, params = []) {
    if (d1) { const result = params.length ? await authority.binding.prepare(sql).bind(...params).all() : await authority.binding.prepare(sql).all(); return result.results || []; }
    return (await postgresDatabase.query(sql, params)).rows || [];
  }
  function event(type, id, row) { return { authorityEpoch: authority.authorityEpoch, direction: d1 ? 'd1_to_postgres' : 'postgres_to_d1', idempotencyKey: `${type}:${id}:${idFactory()}`, entityType: type, entityId: String(id), operation: 'upsert', payload: { id: String(id), row } }; }
  function authSql(source = d1 ? 'd1' : 'postgres') { return d1 ? `EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)` : null; }
  async function write(row, type, table, allowed, mode = 'upsert', statusFrom) {
    for (const key of Object.keys(row)) if (key !== 'id' && !allowed.has(key)) throw new Error(`Unsupported VIP field: ${key}`);
    const id = String(row.id || (type === 'trading_vip_member' ? await stableMemberId(row.workspace_id, row.telegram_id) : idFactory())), full = { ...row, id, created_at: row.created_at || now() };
    if (type === 'trading_vip_member') full.updated_at = row.updated_at || now();
    const fields = Object.keys(full).filter((key) => key !== 'id');
    const e = event(type, id, full);
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    if (d1) {
      const values = fields.map((key) => key === 'trial_used' ? Number(Boolean(full[key])) : full[key]);
      const updates = fields.filter((key) => !['workspace_id', 'telegram_id', 'created_at'].includes(key)).map((key) => `${key}=excluded.${key}`).join(',');
      const conflict = type === 'trading_vip_member' ? ` ON CONFLICT(workspace_id,telegram_id) DO UPDATE SET ${updates}` : '';
      const insert = authority.binding.prepare(`INSERT INTO ${table}(id,${fields.join(',')}) SELECT ?,${fields.map(() => '?').join(',')} WHERE ${authSql()}${conflict}`).bind(id, ...values, authority.authorityEpoch);
      const guard = type === 'trading_vip_member' ? `EXISTS(SELECT 1 FROM ${table} WHERE workspace_id=? AND telegram_id=?)` : `EXISTS(SELECT 1 FROM ${table} WHERE id=?)`;
      const guardValues = type === 'trading_vip_member' ? [String(full.workspace_id), Number(full.telegram_id), authority.authorityEpoch] : [id, authority.authorityEpoch];
      const journal = prepareD1ReplicationAppendStatements(authority.binding, e, { now: () => now(), guardSql: `${guard} AND ${authSql()}`, guardValues });
      const results = await authority.binding.batch([insert, ...journal.statements]);
      if (Number(results?.[0]?.meta?.changes || 0) !== 1) throw new Error('VIP write failed or authority changed');
    } else {
      await postgresDatabase.transaction(async (q) => {
        const control = await q('SELECT active_authority,authority_epoch,writes_fenced FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE');
        const current = control.rows?.[0];
        if (!current || current.active_authority !== 'postgres' || Number(current.authority_epoch) !== Number(authority.authorityEpoch) || current.writes_fenced !== false) throw new Error('Trading storage authority changed or is fenced');
        const params = [id, ...fields.map((key) => full[key])];
        const updates = fields.filter((key) => !['workspace_id', 'telegram_id', 'created_at'].includes(key)).map((key) => `${key}=EXCLUDED.${key}`).join(',');
        const where = statusFrom ? ` WHERE ${table}.status=$${params.length + 1}` : '';
        if (statusFrom) params.push(statusFrom);
        const conflict = type === 'trading_vip_member' ? ` ON CONFLICT(workspace_id,telegram_id) DO UPDATE SET ${updates}${where}` : '';
        await q(`INSERT INTO ${table}(id,${fields.join(',')}) VALUES($1,${fields.map((_, i) => `$${i + 2}`).join(',')})${conflict}`, params);
        await appendPostgresReplicationEventInTransaction(q, e, { now: () => new Date(now()) });
      });
    }
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    const stored = (await query(type === 'trading_vip_member' ? `SELECT * FROM ${members} WHERE workspace_id=${marker} AND telegram_id=${d1 ? '?' : '$2'} LIMIT 1` : `SELECT * FROM ${deposits} WHERE workspace_id=${marker} AND id=${d1 ? '?' : '$2'} LIMIT 1`, type === 'trading_vip_member' ? [String(full.workspace_id), Number(full.telegram_id)] : [String(full.workspace_id), id]))[0] || null;
    return type === 'trading_vip_member' ? asMember(stored) : stored;
  }
  return {
    async getMembership(workspaceId, telegramId) { if (!workspaceId || telegramId == null) return null; await verifyTradingStorageAuthority(authority, { postgresDatabase }); return asMember((await query(`SELECT * FROM ${members} WHERE workspace_id=${marker} AND telegram_id=${d1 ? '?' : '$2'} LIMIT 1`, [String(workspaceId), Number(telegramId)]))[0] || null); },
    async upsertMembership(row) { if (!row.workspace_id || row.telegram_id == null || !row.expires_at) throw new Error('VIP workspace, Telegram ID and expiry are required'); return write({ status: 'active', trial_used: false, subscription_tier: 'monthly', ...row }, 'trading_vip_member', members, MEMBER_FIELDS); },
    async createDeposit(row) { if (!row.workspace_id || row.telegram_id == null || !row.amount || !row.plan_requested || !row.receipt_photo_file_id) throw new Error('VIP deposit fields are incomplete'); return write({ ...row, status: 'pending' }, 'trading_vip_deposit', deposits, DEPOSIT_FIELDS); },
    async getDeposit(workspaceId, id) { if (!workspaceId || !id) return null; await verifyTradingStorageAuthority(authority, { postgresDatabase }); return (await query(`SELECT * FROM ${deposits} WHERE workspace_id=${marker} AND id=${d1 ? '?' : '$2'} LIMIT 1`, [String(workspaceId), String(id)]))[0] || null; },
    async reviewDeposit(workspaceId, id, status) {
      if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid VIP deposit status');
      const existing = await this.getDeposit(workspaceId, id); if (!existing || existing.status !== 'pending') return null;
      const row = { ...existing, status };
      const e = event('trading_vip_deposit', id, row); await verifyTradingStorageAuthority(authority, { postgresDatabase });
      if (d1) {
        const update = authority.binding.prepare(`UPDATE ${deposits} SET status=? WHERE workspace_id=? AND id=? AND status='pending' AND ${authSql()}`).bind(status, String(workspaceId), String(id), authority.authorityEpoch);
        const journal = prepareD1ReplicationAppendStatements(authority.binding, e, { now: () => now(), guardSql: `EXISTS(SELECT 1 FROM ${deposits} WHERE workspace_id=? AND id=? AND status=?) AND ${authSql()}`, guardValues: [String(workspaceId), String(id), status, authority.authorityEpoch] });
        const result = await authority.binding.batch([update, ...journal.statements]); if (Number(result?.[0]?.meta?.changes || 0) !== 1) return null;
      } else await postgresDatabase.transaction(async (q) => {
        const control = await q('SELECT active_authority,authority_epoch,writes_fenced FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE'); const c = control.rows?.[0];
        if (!c || c.active_authority !== 'postgres' || Number(c.authority_epoch) !== Number(authority.authorityEpoch) || c.writes_fenced !== false) throw new Error('Trading storage authority changed or is fenced');
        const updated = await q(`UPDATE ${deposits} SET status=$1 WHERE workspace_id=$2 AND id=$3 AND status='pending' RETURNING id`, [status, String(workspaceId), String(id)]); if (!updated.rows?.length) return;
        await appendPostgresReplicationEventInTransaction(q, e, { now: () => new Date(now()) });
      });
      return this.getDeposit(workspaceId, id);
    },
    async listExpired(workspaceId, at) { await verifyTradingStorageAuthority(authority, { postgresDatabase }); return (await query(`SELECT * FROM ${members} WHERE workspace_id=${marker} AND status IN ('active','trial') AND expires_at < ${d1 ? '?' : '$2'} ORDER BY expires_at`, [String(workspaceId), at])).map(asMember); },
    async listExpiring(workspaceId, from, to) { await verifyTradingStorageAuthority(authority, { postgresDatabase }); return (await query(`SELECT * FROM ${members} WHERE workspace_id=${marker} AND status IN ('active','trial') AND expires_at >= ${d1 ? '?' : '$2'} AND expires_at < ${d1 ? '?' : '$3'} ORDER BY expires_at`, [String(workspaceId), from, to])).map(asMember); },
  };
}
