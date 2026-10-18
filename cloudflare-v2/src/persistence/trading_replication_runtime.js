import { D1ReplicationJournal } from './d1_replication_journal.js';
import { PostgresReplicationJournal } from './postgres_replication_journal.js';
import { replayReplicationPage } from './replication_runner.js';
import { applyTradingReplicationEvent } from './trading_replication_dispatcher.js';
import { createPostgresTradingDatabase } from './postgres_database.js';
import { resolveTradingStorageAuthority, verifyTradingStorageAuthority } from './trading_storage_authority.js';

const CONSUMER = 'trading-passive-replica-v1';

async function readCheckpoint(authority, postgresDatabase, direction) {
  if (authority.kind === 'd1') {
    const row = await authority.binding.prepare(`
      SELECT last_sequence AS lastSequence FROM trading_replication_checkpoints
      WHERE consumer = ? AND direction = ? AND authority_epoch = ?
    `).bind(CONSUMER, direction, authority.authorityEpoch).first();
    return Number(row?.lastSequence || 0);
  }
  const result = await postgresDatabase.query(`
    SELECT last_sequence AS "lastSequence" FROM trading_storage.replication_checkpoints
    WHERE consumer = $1 AND direction = $2 AND authority_epoch = $3
  `, [CONSUMER, direction, authority.authorityEpoch]);
  return Number(result.rows?.[0]?.lastSequence || 0);
}

async function saveCheckpoint(authority, postgresDatabase, { direction, authorityEpoch, sequence }) {
  if (authority.kind === 'd1') {
    const result = await authority.binding.prepare(`
      INSERT INTO trading_replication_checkpoints (consumer, direction, authority_epoch, last_sequence, updated_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM trading_storage_control
        WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = ? AND writes_fenced = 0
      )
      ON CONFLICT (consumer, direction, authority_epoch) DO UPDATE SET
        last_sequence = MAX(last_sequence, excluded.last_sequence), updated_at = excluded.updated_at
    `).bind(CONSUMER, direction, authorityEpoch, sequence, new Date().toISOString(), authorityEpoch).run();
    if (Number(result?.meta?.changes || 0) !== 1) throw new Error('Replication checkpoint rejected by D1 authority fence');
    return;
  }
  await postgresDatabase.transaction(async query => {
    const result = await query(`
      SELECT active_authority, authority_epoch, writes_fenced
      FROM trading_storage.authority_control WHERE singleton_id = 1 FOR SHARE
    `);
    const row = result.rows?.[0];
    if (!row || row.active_authority !== 'postgres' || Number(row.authority_epoch) !== Number(authorityEpoch) || row.writes_fenced !== false) {
      throw new Error('Replication checkpoint rejected by PostgreSQL authority fence');
    }
    await query(`
      INSERT INTO trading_storage.replication_checkpoints (consumer, direction, authority_epoch, last_sequence, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (consumer, direction, authority_epoch) DO UPDATE SET
        last_sequence = GREATEST(trading_storage.replication_checkpoints.last_sequence, EXCLUDED.last_sequence),
        updated_at = EXCLUDED.updated_at
    `, [CONSUMER, direction, authorityEpoch, sequence, new Date().toISOString()]);
  });
}

function safeReplicationErrorCode(error) {
  const code = String(error?.code || (error?.name && error.name !== 'Error' ? error.name : '') || 'REPLICATION_APPLY_FAILED');
  return /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(code) ? code : 'REPLICATION_APPLY_FAILED';
}

async function readSourceSequence(authority, postgresDatabase, direction) {
  if (authority.kind === 'd1') {
    const row = await authority.binding.prepare(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM trading_replication_journal WHERE direction = ? AND authority_epoch = ?`).bind(direction, authority.authorityEpoch).first();
    return Number(row?.sequence || 0);
  }
  const result = await postgresDatabase.query(`SELECT COALESCE(MAX(sequence), 0) AS sequence FROM trading_storage.replication_journal WHERE direction = $1 AND authority_epoch = $2`, [direction, authority.authorityEpoch]);
  return Number(result.rows?.[0]?.sequence || 0);
}

async function recordReplicationHealth(authority, postgresDatabase, { direction, sourceSequence, appliedSequence, errorCode = null }) {
  const timestamp = new Date().toISOString();
  if (authority.kind === 'd1') {
    const result = await authority.binding.prepare(`
      INSERT INTO trading_replication_health(consumer,direction,authority_epoch,source_sequence,applied_sequence,last_success_at,last_error_at,last_error_code,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0)
      ON CONFLICT(consumer,direction,authority_epoch) DO UPDATE SET source_sequence=excluded.source_sequence,
        applied_sequence=excluded.applied_sequence,last_success_at=COALESCE(excluded.last_success_at,trading_replication_health.last_success_at),
        last_error_at=COALESCE(excluded.last_error_at,trading_replication_health.last_error_at),last_error_code=excluded.last_error_code,updated_at=excluded.updated_at
    `).bind(CONSUMER,direction,authority.authorityEpoch,sourceSequence,appliedSequence,errorCode?null:timestamp,errorCode?timestamp:null,errorCode,timestamp,authority.authorityEpoch).run();
    if (Number(result?.meta?.changes || 0) !== 1) throw new Error('Replication health write rejected by D1 authority fence');
    return;
  }
  await postgresDatabase.transaction(async query => {
    const control = await query(`SELECT active_authority,authority_epoch,writes_fenced FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);
    const row=control.rows?.[0];
    if(!row||row.active_authority!=='postgres'||Number(row.authority_epoch)!==Number(authority.authorityEpoch)||row.writes_fenced!==false)throw new Error('Replication health write rejected by PostgreSQL authority fence');
    await query(`INSERT INTO trading_storage.replication_health(consumer,direction,authority_epoch,source_sequence,applied_sequence,last_success_at,last_error_at,last_error_code,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(consumer,direction,authority_epoch) DO UPDATE SET source_sequence=EXCLUDED.source_sequence,applied_sequence=EXCLUDED.applied_sequence,last_success_at=COALESCE(EXCLUDED.last_success_at,trading_storage.replication_health.last_success_at),last_error_at=COALESCE(EXCLUDED.last_error_at,trading_storage.replication_health.last_error_at),last_error_code=EXCLUDED.last_error_code,updated_at=EXCLUDED.updated_at`,[CONSUMER,direction,authority.authorityEpoch,sourceSequence,appliedSequence,errorCode?null:timestamp,errorCode?timestamp:null,errorCode,timestamp]);
  });
}

async function quarantineReplicationEvent(authority, postgresDatabase, direction, event, error) {
  const errorCode=safeReplicationErrorCode(error);const timestamp=new Date().toISOString();
  if(authority.kind==='d1'){
    const result=await authority.binding.prepare(`INSERT INTO trading_replication_quarantine(consumer,direction,authority_epoch,sequence,entity_type,entity_id,error_code,first_seen_at,last_seen_at,attempts) SELECT ?,?,?,?,?,?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority='d1' AND authority_epoch=? AND writes_fenced=0) ON CONFLICT(consumer,direction,authority_epoch,sequence) DO UPDATE SET last_seen_at=excluded.last_seen_at,attempts=trading_replication_quarantine.attempts+1,error_code=excluded.error_code`).bind(CONSUMER,direction,authority.authorityEpoch,event.sequence,String(event.entityType||'unknown').slice(0,120),String(event.entityId||'unknown').slice(0,200),errorCode,timestamp,timestamp,authority.authorityEpoch).run();
    if(Number(result?.meta?.changes||0)!==1)throw new Error('Replication quarantine write rejected by D1 authority fence');return;
  }
  await postgresDatabase.transaction(async query=>{const c=await query(`SELECT active_authority,authority_epoch,writes_fenced FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);const row=c.rows?.[0];if(!row||row.active_authority!=='postgres'||Number(row.authority_epoch)!==Number(authority.authorityEpoch)||row.writes_fenced!==false)throw new Error('Replication quarantine write rejected by PostgreSQL authority fence');await query(`INSERT INTO trading_storage.replication_quarantine(consumer,direction,authority_epoch,sequence,entity_type,entity_id,error_code,first_seen_at,last_seen_at,attempts) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,1) ON CONFLICT(consumer,direction,authority_epoch,sequence) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,attempts=trading_storage.replication_quarantine.attempts+1,error_code=EXCLUDED.error_code`,[CONSUMER,direction,authority.authorityEpoch,event.sequence,String(event.entityType||'unknown').slice(0,120),String(event.entityId||'unknown').slice(0,200),errorCode,timestamp]);});
}

/** Build a bounded one-way replay runtime for the selected authority and its passive replica. */
export async function createTradingReplicationRuntime(env = {}, {
  postgresDatabase: suppliedPostgresDatabase = null,
  ClientClass,
  pageSize = 100,
  maxPages = 5,
} = {}) {
  const authority = resolveTradingStorageAuthority(env);
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new Error('D1 binding DB is required for passive replication');
  if (!env.TRADING_PG || typeof env.TRADING_PG.connectionString !== 'string' || !env.TRADING_PG.connectionString.trim()) {
    throw new Error('TRADING_PG Hyperdrive binding is required for passive replication');
  }

  const postgresDatabase = suppliedPostgresDatabase || await createPostgresTradingDatabase(env.TRADING_PG, { ClientClass });
  const ownsPostgresDatabase = !suppliedPostgresDatabase;
  const sourceJournal = authority.kind === 'd1'
    ? new D1ReplicationJournal(env.DB)
    : new PostgresReplicationJournal(postgresDatabase);
  const passiveAuthority = authority.kind === 'd1'
    ? Object.freeze({ kind: 'postgres', authorityEpoch: authority.authorityEpoch })
    : Object.freeze({ kind: 'd1', binding: env.DB, authorityEpoch: authority.authorityEpoch });
  const direction = authority.kind === 'd1' ? 'd1_to_postgres' : 'postgres_to_d1';

  return {
    async run() {
      await verifyTradingStorageAuthority(authority, { postgresDatabase });
      let checkpoint = await readCheckpoint(authority, postgresDatabase, direction);
      let pages = 0;
      let applied = 0;
      let hasMore = true;
      let blocked = null;
      while (hasMore && pages < Math.max(1, Math.min(20, Math.trunc(Number(maxPages) || 5)))) {
        let result;
        try {
          result = await replayReplicationPage({
            journal: sourceJournal,
            direction,
            authorityEpoch: authority.authorityEpoch,
            checkpoint,
            limit: pageSize,
            applyEvent: async event => {
              try { await applyTradingReplicationEvent(event, { targetAuthority: passiveAuthority, postgresDatabase }); }
              catch (error) { await quarantineReplicationEvent(authority, postgresDatabase, direction, event, error); throw error; }
            },
            saveCheckpoint: value => saveCheckpoint(authority, postgresDatabase, value),
          });
        } catch (error) {
          blocked = { sequence: Number(error?.received || checkpoint + 1), errorCode: safeReplicationErrorCode(error) };
          break;
        }
        pages += 1;
        applied += result.applied;
        checkpoint = result.checkpoint;
        hasMore = result.hasMore;
        if (result.applied === 0) break;
      }
      const sourceSequence = await readSourceSequence(authority, postgresDatabase, direction);
      await recordReplicationHealth(authority, postgresDatabase, { direction, sourceSequence, appliedSequence: checkpoint, errorCode: blocked?.errorCode || null });
      if (blocked) console.error('Trading replication blocked at sequence', { direction, authorityEpoch: authority.authorityEpoch, ...blocked });
      return { authority: authority.kind, direction, checkpoint, pages, applied, hasMore, lag: Math.max(0, sourceSequence-checkpoint), ...(blocked ? { ok: false, blocked } : { ok: true }) };
    },
    async close() { if (ownsPostgresDatabase) await postgresDatabase.close(); },
  };
}
