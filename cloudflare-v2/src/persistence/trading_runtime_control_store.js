import { verifyTradingStorageAuthority } from './trading_storage_authority.js';
import { prepareD1ReplicationAppendStatements } from './d1_replication_journal.js';
import { appendPostgresReplicationEventInTransaction } from './postgres_replication_journal.js';

const CONTROL_KEYS = Object.freeze({
  tradingAccess: 'trading_access_enabled',
  brokerExecution: 'broker_execution_enabled',
  liveBrokerExecution: 'live_broker_execution_enabled',
});

function unavailable(reason = 'RUNTIME_CONTROL_UNAVAILABLE') {
  return { ok: false, enabled: false, reason };
}

function publicControl(row) {
  if (!row) return unavailable();
  return {
    ok: true,
    enabled: row.enabled === true || row.enabled === 1,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    updatedBy: row.updatedBy ?? row.updated_by ?? null,
  };
}

/** D1/Postgres implementation matching the existing runtime-control contract. */
export function createTradingRuntimeControlStore({ authority, postgresDatabase, now = () => new Date().toISOString(), idFactory = () => globalThis.crypto.randomUUID() } = {}) {
  if (!authority || !['d1', 'postgres'].includes(authority.kind)) throw new TypeError('Resolved D1 or PostgreSQL authority is required');
  if (authority.kind === 'postgres' && !postgresDatabase) throw new TypeError('Connected PostgreSQL database is required');

  async function getControl(controlKey) {
    try {
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      let row;
      if (authority.kind === 'd1') {
        row = await authority.binding.prepare(`
          SELECT control_key AS controlKey, enabled, updated_at AS updatedAt, updated_by AS updatedBy
          FROM trading_runtime_controls WHERE control_key = ?
        `).bind(controlKey).first();
      } else {
        const result = await postgresDatabase.query(`
          SELECT control_key AS "controlKey", enabled, updated_at AS "updatedAt", updated_by AS "updatedBy"
          FROM trading_storage.runtime_controls WHERE control_key = $1
        `, [controlKey]);
        row = result.rows?.[0] || null;
      }
      return publicControl(row);
    } catch {
      return unavailable();
    }
  }

  async function setControl(controlKey, enabled, { updatedBy = 'mkety-admin' } = {}) {
    const row = {
      controlKey,
      enabled: enabled === true,
      updatedBy: String(updatedBy || 'mkety-admin'),
      updatedAt: now(),
    };
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    const event = {
      authorityEpoch: authority.authorityEpoch,
      direction: authority.kind === 'd1' ? 'd1_to_postgres' : 'postgres_to_d1',
      idempotencyKey: `runtime-control:${idFactory()}`,
      entityType: 'trading_runtime_control',
      entityId: row.controlKey,
      operation: 'upsert',
      payload: row,
    };
    if (authority.kind === 'd1') {
      const controlWrite = authority.binding.prepare(`
        INSERT INTO trading_runtime_controls (control_key, enabled, updated_by, updated_at)
        SELECT ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM trading_storage_control
          WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = ? AND writes_fenced = 0
        )
        ON CONFLICT(control_key) DO UPDATE SET enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `).bind(row.controlKey, row.enabled ? 1 : 0, row.updatedBy, row.updatedAt, authority.authorityEpoch);
      // The safety control and its passive-replica event commit in one D1 batch.
      const guardSql = `EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = ? AND writes_fenced = 0)`;
      const { statements } = prepareD1ReplicationAppendStatements(authority.binding, event, {
        now: () => row.updatedAt,
        guardSql,
        guardValues: [authority.authorityEpoch],
      });
      const results = await authority.binding.batch([controlWrite, ...statements]);
      if (Number(results?.[0]?.meta?.changes || 0) !== 1) throw new Error('Trading storage authority changed during runtime-control update');
    } else {
      await postgresDatabase.transaction(async query => {
        const authorityResult = await query(`
          SELECT active_authority AS "activeAuthority", authority_epoch AS "authorityEpoch", writes_fenced AS "writesFenced"
          FROM trading_storage.authority_control WHERE singleton_id = 1 FOR SHARE
        `);
        const persistedAuthority = authorityResult.rows?.[0];
        if (!persistedAuthority || persistedAuthority.activeAuthority !== 'postgres' || Number(persistedAuthority.authorityEpoch) !== Number(authority.authorityEpoch) || persistedAuthority.writesFenced !== false) {
          throw new Error('Trading storage authority changed or is fenced during runtime-control update');
        }
        await query(`
          INSERT INTO trading_storage.runtime_controls (control_key, enabled, updated_by, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (control_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
        `, [row.controlKey, row.enabled, row.updatedBy, row.updatedAt]);
        await appendPostgresReplicationEventInTransaction(query, event, { now: () => new Date(row.updatedAt) });
      });
    }
    return publicControl(row);
  }

  async function getExecutionControls() {
    try {
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      const keys = Object.values(CONTROL_KEYS);
      const rows = authority.kind === 'd1'
        ? (await authority.binding.prepare(`SELECT control_key AS controlKey, enabled, updated_at AS updatedAt, updated_by AS updatedBy FROM trading_runtime_controls WHERE control_key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all()).results || []
        : (await postgresDatabase.query(`SELECT control_key AS "controlKey", enabled, updated_at AS "updatedAt", updated_by AS "updatedBy" FROM trading_storage.runtime_controls WHERE control_key = ANY($1::text[])`, [keys])).rows || [];
      const byKey = new Map(rows.map((row) => [String(row.controlKey || row.control_key), publicControl(row)]));
      return {
        tradingAccess: byKey.get(CONTROL_KEYS.tradingAccess) || unavailable(),
        brokerExecution: byKey.get(CONTROL_KEYS.brokerExecution) || unavailable(),
        liveBrokerExecution: byKey.get(CONTROL_KEYS.liveBrokerExecution) || unavailable(),
      };
    } catch {
      return { tradingAccess: unavailable(), brokerExecution: unavailable(), liveBrokerExecution: unavailable() };
    }
  }

  return {
    getExecutionControls,
    getTradingAccessEnabled: () => getControl(CONTROL_KEYS.tradingAccess),
    setTradingAccessEnabled: (enabled, options) => setControl(CONTROL_KEYS.tradingAccess, enabled, options),
    getBrokerExecutionEnabled: () => getControl(CONTROL_KEYS.brokerExecution),
    setBrokerExecutionEnabled: (enabled, options) => setControl(CONTROL_KEYS.brokerExecution, enabled, options),
    getLiveBrokerExecutionEnabled: () => getControl(CONTROL_KEYS.liveBrokerExecution),
    setLiveBrokerExecutionEnabled: (enabled, options) => setControl(CONTROL_KEYS.liveBrokerExecution, enabled, options),
  };
}
