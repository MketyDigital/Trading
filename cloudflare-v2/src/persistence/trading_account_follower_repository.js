import { verifyTradingStorageAuthority } from './trading_storage_authority.js';
import { prepareD1ReplicationAppendStatements } from './d1_replication_journal.js';
import { appendPostgresReplicationEventInTransaction } from './postgres_replication_journal.js';

const FIELDS = new Set(['workspace_id', 'follower_account_id', 'parent_account_id', 'enabled', 'lot_multiplier', 'fixed_lot', 'last_source_version', 'last_state_fingerprint', 'created_at', 'updated_at']);
function text(value) { return String(value ?? '').trim(); }
function bool(value) { return value === true || value === 1 || value === '1'; }
function positive(value, fallback = null) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
function encode(row, d1) { return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'boolean' && d1 ? Number(value) : value])); }
function decode(row) { if (!row) return null; return { ...row, enabled: bool(row.enabled), lot_multiplier: Number(row.lot_multiplier), fixed_lot: row.fixed_lot == null ? null : Number(row.fixed_lot) }; }

export function createTradingAccountFollowerRepository({ authority, postgresDatabase, idFactory = () => globalThis.crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  if (!authority || !['d1', 'postgres'].includes(authority.kind)) throw new TypeError('Resolved D1 or PostgreSQL authority is required');
  if (authority.kind === 'postgres' && !postgresDatabase) throw new TypeError('Connected PostgreSQL database is required');
  const d1 = authority.kind === 'd1';
  const table = d1 ? 'trading_account_followers' : 'trading_storage.trading_account_followers';
  async function query(sql, params = []) {
    if (d1) return (await (params.length ? authority.binding.prepare(sql).bind(...params) : authority.binding.prepare(sql)).all()).results || [];
    return (await postgresDatabase.query(sql, params)).rows || [];
  }
  function event(id, operation, payload) {
    return { authorityEpoch: authority.authorityEpoch, direction: d1 ? 'd1_to_postgres' : 'postgres_to_d1', idempotencyKey: `account-follower:${id}:${idFactory()}`, entityType: 'trading_account_follower', entityId: String(id), operation, payload };
  }
  async function record(e, write, { guardSql = '', guardValues = [] } = {}) {
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    if (d1) {
      const authorityGuard = `EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)`;
      const guard = [guardSql, authorityGuard].filter(Boolean).map((part) => `(${part})`).join(' AND ');
      const journal = prepareD1ReplicationAppendStatements(authority.binding, e, { now, guardSql: guard, guardValues: [...guardValues, authority.authorityEpoch] });
      const result = await authority.binding.batch([write, ...journal.statements]);
      if (Number(result?.[0]?.meta?.changes || 0) !== 1) throw new Error('Follower link write did not apply or authority changed');
      return;
    }
    await postgresDatabase.transaction(async (q) => {
      const control = await q(`SELECT active_authority,authority_epoch,writes_fenced FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);
      const row = control.rows?.[0];
      if (!row || row.active_authority !== 'postgres' || Number(row.authority_epoch) !== Number(authority.authorityEpoch) || row.writes_fenced !== false) throw new Error('Trading storage authority changed or is fenced');
      const result = await write(q);
      if (!result) throw new Error('Follower link write did not apply');
      await appendPostgresReplicationEventInTransaction(q, e, { now: () => new Date(now()) });
    });
  }
  async function account(workspaceId, id) {
    const rows = await query(`SELECT id,workspace_id,is_active FROM ${d1 ? 'trade_accounts' : 'trading_storage.trade_accounts'} WHERE workspace_id=${d1 ? '?' : '$1'} AND id=${d1 ? '?' : '$2'} LIMIT 1`, [String(workspaceId), String(id)]);
    return rows[0] || null;
  }
  async function validateLink(workspaceId, followerId, parentId) {
    if (followerId === parentId) throw new Error('FOLLOWER_LINK_SELF');
    const [follower, parent] = await Promise.all([account(workspaceId, followerId), account(workspaceId, parentId)]);
    if (!follower || !parent || text(follower.workspace_id) !== text(workspaceId) || text(parent.workspace_id) !== text(workspaceId) || !bool(follower.is_active) || !bool(parent.is_active)) throw new Error('FOLLOWER_LINK_ACCOUNT_NOT_FOUND');
    const nested = await query(`SELECT id FROM ${table} WHERE workspace_id=${d1 ? '?' : '$1'} AND follower_account_id=${d1 ? '?' : '$2'} AND enabled=${d1 ? '1' : 'TRUE'} LIMIT 1`, [String(workspaceId), parentId]);
    if (nested.length) throw new Error('FOLLOWER_LINK_PARENT_IS_FOLLOWER');
  }
  async function getLink(workspaceId, followerId) {
    const rows = await query(`SELECT id,workspace_id,follower_account_id,parent_account_id,enabled,lot_multiplier,fixed_lot,last_source_version,last_state_fingerprint,created_at,updated_at FROM ${table} WHERE workspace_id=${d1 ? '?' : '$1'} AND follower_account_id=${d1 ? '?' : '$2'} LIMIT 1`, [String(workspaceId), String(followerId)]);
    return decode(rows[0]);
  }
  return {
    async getLink(workspaceId, followerId) { if (!workspaceId || !followerId) return null; await verifyTradingStorageAuthority(authority, { postgresDatabase }); return getLink(workspaceId, followerId); },
    async listEnabledByParents(workspaceId, parentIds = []) {
      const ids = [...new Set(parentIds.map(text).filter(Boolean))];
      if (!workspaceId || !ids.length) return [];
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      const placeholders = ids.map((_, index) => d1 ? '?' : `$${index + 2}`).join(',');
      const rows = await query(`SELECT id,workspace_id,follower_account_id,parent_account_id,enabled,lot_multiplier,fixed_lot,last_source_version,last_state_fingerprint,created_at,updated_at FROM ${table} WHERE workspace_id=${d1 ? '?' : '$1'} AND enabled=${d1 ? '1' : 'TRUE'} AND parent_account_id IN (${placeholders}) ORDER BY parent_account_id ASC, follower_account_id ASC`, [String(workspaceId), ...ids]);
      return rows.map(decode);
    },
    async listEnabledByFollowers(workspaceId, followerIds = []) {
      const ids = [...new Set(followerIds.map(text).filter(Boolean))];
      if (!workspaceId || !ids.length) return [];
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      const placeholders = ids.map((_, index) => d1 ? '?' : `$${index + 2}`).join(',');
      const rows = await query(`SELECT id,workspace_id,follower_account_id,parent_account_id,enabled,lot_multiplier,fixed_lot,last_source_version,last_state_fingerprint,created_at,updated_at FROM ${table} WHERE workspace_id=${d1 ? '?' : '$1'} AND enabled=${d1 ? '1' : 'TRUE'} AND follower_account_id IN (${placeholders}) ORDER BY follower_account_id ASC`, [String(workspaceId), ...ids]);
      return rows.map(decode);
    },
    async upsertLink(workspaceId, input = {}) {
      const followerId = text(input.followerAccountId ?? input.follower_account_id);
      const parentId = text(input.parentAccountId ?? input.parent_account_id);
      if (!workspaceId || !followerId || !parentId) throw new Error('FOLLOWER_LINK_REQUIRED');
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      await validateLink(workspaceId, followerId, parentId);
      const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
      const lotMultiplier = positive(input.lotMultiplier ?? input.lot_multiplier, 1);
      const fixedLot = input.fixedLot ?? input.fixed_lot;
      const fixed = fixedLot == null || fixedLot === '' ? null : positive(fixedLot);
      if (!(lotMultiplier > 0) || (fixedLot != null && fixed == null)) throw new Error('FOLLOWER_LINK_LOT_POLICY_INVALID');
      const current = await getLink(workspaceId, followerId);
      const next = { workspace_id: String(workspaceId), follower_account_id: followerId, parent_account_id: parentId, enabled, lot_multiplier: lotMultiplier, fixed_lot: fixed, last_source_version: input.lastSourceVersion ?? input.last_source_version ?? null, last_state_fingerprint: input.lastStateFingerprint ?? input.last_state_fingerprint ?? null, updated_at: now() };
      if (current && ['parent_account_id', 'enabled', 'lot_multiplier', 'fixed_lot', 'last_source_version', 'last_state_fingerprint'].every((key) => String(current[key] ?? '') === String(next[key] ?? ''))) return current;
      const id = current?.id || String(input.id || idFactory());
      if (!current) next.created_at = now();
      const encoded = encode(next, d1);
      const columns = Object.keys(encoded);
      const e = event(id, 'upsert', { ...next, _mutation: current ? 'update' : 'insert' });
      if (d1) {
        const statement = current
          ? authority.binding.prepare(`UPDATE ${table} SET ${columns.filter((key) => key !== 'workspace_id').map((key) => `${key}=?`).join(',')} WHERE workspace_id=? AND follower_account_id=? AND EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)`).bind(...columns.filter((key) => key !== 'workspace_id').map((key) => encoded[key]), String(workspaceId), followerId, authority.authorityEpoch)
          : authority.binding.prepare(`INSERT INTO ${table}(id,${columns.join(',')}) SELECT ?,${columns.map(() => '?').join(',')} WHERE EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)`).bind(id, ...columns.map((key) => encoded[key]), authority.authorityEpoch);
        await record(e, statement, { guardSql: current ? 'EXISTS(SELECT 1 FROM trading_account_followers WHERE workspace_id=? AND follower_account_id=?)' : '', guardValues: current ? [String(workspaceId), followerId] : [] });
      } else {
        await record(e, async (q) => {
          if (current) {
            const keys = columns.filter((key) => key !== 'workspace_id');
            return (await q(`UPDATE ${table} SET ${keys.map((key, i) => `${key}=$${i + 1}${key === 'lot_multiplier' || key === 'fixed_lot' ? '::numeric' : ''}`).join(',')} WHERE workspace_id=$${keys.length + 1} AND follower_account_id=$${keys.length + 2} RETURNING id`, [...keys.map((key) => encoded[key]), String(workspaceId), followerId])).rows?.[0];
          }
          return (await q(`INSERT INTO ${table}(id,${columns.join(',')}) VALUES($1,${columns.map((key, i) => `$${i + 2}${key === 'lot_multiplier' || key === 'fixed_lot' ? '::numeric' : ''}`).join(',')}) RETURNING id`, [id, ...columns.map((key) => encoded[key])])).rows?.[0];
        });
      }
      return getLink(workspaceId, followerId);
    },
    async setEnabled(workspaceId, followerId, enabled) { const current = await getLink(workspaceId, followerId); if (!current) return null; return this.upsertLink(workspaceId, { ...current, enabled: Boolean(enabled) }); },
    async deleteLink(workspaceId, followerId) { const current = await getLink(workspaceId, followerId); if (!current) return false; const e = event(current.id, 'delete', { workspace_id: String(workspaceId), follower_account_id: String(followerId), _mutation: 'delete' }); if (d1) { const statement = authority.binding.prepare(`DELETE FROM ${table} WHERE workspace_id=? AND follower_account_id=? AND EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)`).bind(String(workspaceId), String(followerId), authority.authorityEpoch); await record(e, statement, { guardSql: 'EXISTS(SELECT 1 FROM trading_account_followers WHERE workspace_id=? AND follower_account_id=?)', guardValues: [String(workspaceId), String(followerId)] }); } else { await record(e, async (q) => (await q(`DELETE FROM ${table} WHERE workspace_id=$1 AND follower_account_id=$2 RETURNING id`, [String(workspaceId), String(followerId)])).rows?.[0]); } return true; },
  };
}
