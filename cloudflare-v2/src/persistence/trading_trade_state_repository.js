import { groupToPersistenceRows, persistenceRowsToGroup } from './trade_state_mapping.js';
import { verifyTradingStorageAuthority } from './trading_storage_authority.js';
import { prepareD1ReplicationAppendStatements } from './d1_replication_journal.js';
import { appendPostgresReplicationEventInTransaction } from './postgres_replication_journal.js';

const D1_JSON_COLUMNS = new Set(['entry', 'risk_plan', 'policy_snapshot', 'source_event_ids', 'broker_deal_ids']);
const ACTIVE_STATUSES = ['OPEN', 'PLANNED', 'PENDING'];
const ACTIVE_LEG_COLUMNS = [
  'id', 'workspace_id', 'position_group_id', 'runtime_leg_id', 'target_index', 'logical_target_index', 'lots',
  'requested_lots', 'executed_lots', 'remaining_lots', 'stop_loss', 'take_profit', 'status', 'broker_position_id',
  'broker_order_id', 'broker_deal_id', 'broker_deal_ids', 'fill_price', 'volume_step_lots', 'minimum_lots',
  'action_type', 'failure_code', 'parent_leg_id', 'lifecycle_role', 'lifecycle_tracking_enabled',
  'originating_order_id', 'last_broker_observed_at', 'last_broker_source_version', 'last_broker_status',
  'last_broker_snapshot_fingerprint', 'opened_at', 'closed_at', 'created_at', 'updated_at',
];

function encodeD1Row(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (D1_JSON_COLUMNS.has(key) && value !== null) return [key, JSON.stringify(value)];
    if (typeof value === 'boolean') return [key, value ? 1 : 0];
    return [key, value];
  }));
}

function decodeD1Row(row) {
  if (!row) return null;
  const decoded = { ...row };
  for (const key of D1_JSON_COLUMNS) {
    if (typeof decoded[key] === 'string') {
      try { decoded[key] = JSON.parse(decoded[key]); } catch { decoded[key] = key === 'source_event_ids' || key === 'broker_deal_ids' ? [] : {}; }
    }
  }
  return decoded;
}

function placeholders(count, offset = 1) {
  return Array.from({ length: count }, (_, index) => `$${index + offset}`);
}

function d1UpsertStatement(binding, table, row, { id, conflict, guardValues }) {
  const encoded = encodeD1Row(row);
  const columns = Object.keys(encoded);
  const values = columns.map(key => encoded[key]);
  const allColumns = ['id', ...columns];
  const updates = columns.filter(column => !conflict.includes(column)).map(column => `${column} = excluded.${column}`);
  const guard = `EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = ? AND writes_fenced = 0)`;
  const sql = `INSERT INTO ${table} (${allColumns.join(', ')}) SELECT ?, ${columns.map(() => '?').join(', ')} WHERE ${guard} ON CONFLICT(${conflict.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
  return binding.prepare(sql).bind(id, ...values, ...guardValues);
}

function d1LegUpsertStatement(binding, row, id, group, epoch) {
  const encoded = encodeD1Row(row);
  const columns = Object.keys(encoded);
  const updates = columns.filter(column => !['workspace_id', 'runtime_leg_id'].includes(column)).map(column => `${column} = excluded.${column}`);
  const sql = `INSERT INTO position_legs (id, position_group_id, ${columns.join(', ')})
    SELECT ?, (SELECT id FROM position_groups WHERE workspace_id = ? AND runtime_group_id = ?), ${columns.map(() => '?').join(', ')}
    WHERE EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = ? AND writes_fenced = 0)
    ON CONFLICT(position_group_id, runtime_leg_id) DO UPDATE SET ${updates.join(', ')}`;
  return binding.prepare(sql).bind(id, group.workspace_id, group.runtime_group_id, ...columns.map(key => encoded[key]), epoch);
}

function pgUpsertSql(table, row, conflictColumns, schema = 'trading_storage') {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const conflict = conflictColumns.join(', ');
  const updates = columns.filter(column => !conflictColumns.includes(column)).map(column => `${column} = EXCLUDED.${column}`);
  const sql = `INSERT INTO ${schema}.${table} (${columns.join(', ')}) VALUES (${placeholders(columns.length).join(', ')}) ON CONFLICT (${conflict}) DO UPDATE SET ${updates.join(', ')} RETURNING id`;
  return { sql, values };
}

function toCandidate(row) {
  const group = decodeD1Row(row.position_groups || {});
  const asNumberOrNull = value => value == null ? null : Number(value);
  return {
    workspaceId: String(row.workspace_id || ''), groupId: String(group.runtime_group_id || row.position_group_id || ''),
    persistenceGroupId: String(row.position_group_id || ''), tradeAccountId: String(group.trade_account_id || ''),
    sourceEventId: String(group.source_event_id || ''), sourceInstanceId: group.source_instance_id == null ? null : String(group.source_instance_id),
    sourceEventIds: Array.isArray(group.source_event_ids) ? group.source_event_ids.map(String) : [],
    threadId: group.thread_id == null ? null : String(group.thread_id), symbol: String(group.canonical_symbol || ''),
    side: String(group.side || '').toUpperCase(), orderType: String(group.order_type || '').toUpperCase(),
    entry: group.entry && typeof group.entry === 'object' ? group.entry : {},
    groupStopLoss: asNumberOrNull(group.stop_loss), groupCreatedAt: group.created_at ? new Date(group.created_at).getTime() : undefined,
    groupUpdatedAt: group.updated_at ? new Date(group.updated_at).getTime() : undefined,
    legId: String(row.runtime_leg_id || ''), targetIndex: Number(row.logical_target_index ?? row.target_index),
    lots: Number(row.lots), executedLots: asNumberOrNull(row.executed_lots), brokerPositionId: String(row.broker_position_id || ''),
    stopLoss: asNumberOrNull(row.stop_loss ?? group.stop_loss), takeProfit: asNumberOrNull(row.take_profit),
    lastBrokerObservedAt: row.last_broker_observed_at ? new Date(row.last_broker_observed_at).getTime() : undefined,
    lastBrokerSnapshotFingerprint: row.last_broker_snapshot_fingerprint == null ? null : String(row.last_broker_snapshot_fingerprint),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
  };
}

function validCandidate(row) {
  return row.workspaceId && row.groupId && row.tradeAccountId && row.legId && row.brokerPositionId
    && Number.isInteger(row.targetIndex) && row.targetIndex > 0;
}

export function createTradingTradeStatePersistence({ authority, postgresDatabase, now = () => new Date().toISOString(), idFactory = () => globalThis.crypto.randomUUID() } = {}) {
  if (!authority || !['d1', 'postgres'].includes(authority.kind)) throw new TypeError('Resolved D1 or PostgreSQL authority is required');
  if (authority.kind === 'postgres' && !postgresDatabase) throw new TypeError('Connected PostgreSQL database is required');

  async function saveGroup(group) {
    const rows = groupToPersistenceRows(group);
    const event = {
      authorityEpoch: authority.authorityEpoch,
      direction: authority.kind === 'd1' ? 'd1_to_postgres' : 'postgres_to_d1',
      idempotencyKey: `trade-state:${idFactory()}`,
      entityType: 'trade_state_group', entityId: `${rows.group.workspace_id}:${rows.group.runtime_group_id}`,
      operation: 'upsert', payload: { group: rows.group, legs: rows.legs },
    };
    if (authority.kind === 'd1') {
      const groupId = idFactory();
      const groupWrite = d1UpsertStatement(authority.binding, 'position_groups', rows.group, {
        id: groupId, conflict: ['workspace_id', 'runtime_group_id'], guardValues: [authority.authorityEpoch],
      });
      const statements = [groupWrite, ...rows.legs.map((leg, index) => d1LegUpsertStatement(
        authority.binding, leg, idFactory(), rows.group, authority.authorityEpoch,
      ))];
      const guardSql = `EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id = 1 AND active_authority = 'd1' AND authority_epoch = ? AND writes_fenced = 0)`;
      const journal = prepareD1ReplicationAppendStatements(authority.binding, event, {
        now: () => now(), guardSql, guardValues: [authority.authorityEpoch],
      });
      const results = await authority.binding.batch([...statements, ...journal.statements]);
      if (Number(results?.[0]?.meta?.changes || 0) !== 1) throw new Error('Trading storage authority changed or write-fenced during trade-state update');
    } else {
      await postgresDatabase.transaction(async query => {
        const result = await query(`SELECT active_authority, authority_epoch, writes_fenced FROM trading_storage.authority_control WHERE singleton_id = 1 FOR SHARE`);
        const row = result.rows?.[0];
        if (!row || row.active_authority !== 'postgres' || Number(row.authority_epoch) !== Number(authority.authorityEpoch) || row.writes_fenced !== false) {
          throw new Error('Trading storage authority changed or is fenced during trade-state update');
        }
        const groupUpsert = pgUpsertSql('position_groups', rows.group, ['workspace_id', 'runtime_group_id']);
        const saved = await query(groupUpsert.sql, groupUpsert.values);
        const groupId = saved.rows?.[0]?.id;
        if (!groupId) throw new Error('Trade-state group upsert did not return its row id');
        for (const leg of rows.legs) {
          const legRow = { ...leg, position_group_id: groupId };
          delete legRow.id;
          const upsert = pgUpsertSql('position_legs', legRow, ['position_group_id', 'runtime_leg_id']);
          await query(upsert.sql, upsert.values);
        }
        await appendPostgresReplicationEventInTransaction(query, event, { now: () => new Date(now()) });
      });
    }
    return group;
  }

  async function loadGroup(workspaceId, groupId) {
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    if (authority.kind === 'd1') {
      const row = await authority.binding.prepare(`SELECT * FROM position_groups WHERE workspace_id = ? AND (runtime_group_id = ? OR id = ?) ORDER BY CASE WHEN runtime_group_id = ? THEN 0 ELSE 1 END LIMIT 1`).bind(String(workspaceId), String(groupId), String(groupId), String(groupId)).first();
      if (!row) return null;
      const legs = await authority.binding.prepare(`SELECT * FROM position_legs WHERE position_group_id = ? ORDER BY target_index`).bind(row.id).all();
      return persistenceRowsToGroup({ ...decodeD1Row(row), position_legs: (legs.results || []).map(decodeD1Row) });
    }
    const result = await postgresDatabase.query(`SELECT g.*, COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.target_index) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb) AS position_legs FROM trading_storage.position_groups g LEFT JOIN trading_storage.position_legs l ON l.position_group_id = g.id WHERE g.workspace_id = $1 AND (g.runtime_group_id = $2 OR g.id::text = $2) GROUP BY g.id ORDER BY CASE WHEN g.runtime_group_id = $2 THEN 0 ELSE 1 END LIMIT 1`, [String(workspaceId), String(groupId)]);
    return result.rows?.[0] ? persistenceRowsToGroup(result.rows[0]) : null;
  }

  async function loadActive(workspaceId) {
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    let rows;
    if (authority.kind === 'd1') {
      rows = [];
      const legJson = ACTIVE_LEG_COLUMNS.map(column => `'${column}', l.${column}`).join(', ');
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const result = await authority.binding.prepare(`SELECT g.*, COALESCE(json_group_array(json_object(${legJson})) FILTER (WHERE l.id IS NOT NULL), '[]') AS position_legs
          FROM position_groups g LEFT JOIN position_legs l ON l.position_group_id = g.id
          WHERE g.workspace_id = ? AND g.status IN (?, ?, ?) GROUP BY g.id
          ORDER BY g.updated_at DESC, g.id LIMIT ? OFFSET ?`)
          .bind(String(workspaceId), ...ACTIVE_STATUSES, pageSize, offset).all();
        const page = result.results || [];
        for (const group of page) {
          let legs = [];
          try { legs = JSON.parse(group.position_legs || '[]'); } catch { throw new Error('active trade state recovery returned invalid leg JSON'); }
          rows.push({ ...decodeD1Row(group), position_legs: legs.map(decodeD1Row) });
        }
        if (page.length < pageSize) break;
      }
    } else {
      const result = await postgresDatabase.query(`SELECT g.*, COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.target_index) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb) AS position_legs FROM trading_storage.position_groups g LEFT JOIN trading_storage.position_legs l ON l.position_group_id = g.id WHERE g.workspace_id = $1 AND g.status = ANY($2::text[]) GROUP BY g.id ORDER BY g.updated_at DESC`, [String(workspaceId), ACTIVE_STATUSES]);
      rows = result.rows || [];
    }
    return rows.map(persistenceRowsToGroup);
  }

  async function listPendingOrderLifecycles({ limit = 200 } = {}) {
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    const size = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 200)));
    const sql = `SELECT l.workspace_id, l.runtime_leg_id, l.broker_order_id, l.created_at, g.runtime_group_id, g.trade_account_id, g.canonical_symbol
      FROM ${authority.kind === 'd1' ? '' : 'trading_storage.'}position_legs l JOIN ${authority.kind === 'd1' ? '' : 'trading_storage.'}position_groups g ON g.id = l.position_group_id
      WHERE l.status = 'PENDING' AND l.lifecycle_tracking_enabled = ${authority.kind === 'd1' ? '1' : 'true'} AND l.broker_order_id IS NOT NULL
      ORDER BY l.created_at ASC, l.id ASC LIMIT ${authority.kind === 'd1' ? '?' : '$1'}`;
    const rows = authority.kind === 'd1'
      ? (await authority.binding.prepare(sql).bind(size).all()).results || []
      : (await postgresDatabase.query(sql, [size])).rows || [];
    return rows.map(row => ({ workspaceId: String(row.workspace_id), groupId: String(row.runtime_group_id || ''), tradeAccountId: String(row.trade_account_id || ''), legId: String(row.runtime_leg_id || ''), brokerOrderId: String(row.broker_order_id || ''), symbol: String(row.canonical_symbol || ''), createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined }))
      .filter(row => row.workspaceId && row.groupId && row.tradeAccountId && row.legId && row.brokerOrderId && row.symbol);
  }

  async function hasSourceEventGroup(workspaceId, eventId, externalEventId) {
    if (!workspaceId || !eventId) return false;
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    const schema = authority.kind === 'd1' ? '' : 'trading_storage.';
    const sql = authority.kind === 'd1'
      ? `SELECT 1 AS found FROM ${schema}position_groups WHERE workspace_id=? AND (source_event_id=? OR EXISTS (SELECT 1 FROM json_each(COALESCE(source_event_ids,'[]')) WHERE value=?)) LIMIT 1`
      : `SELECT 1 AS found FROM ${schema}position_groups WHERE workspace_id=$1 AND (source_event_id=$2 OR source_event_ids @> $3::jsonb) LIMIT 1`;
    const values = authority.kind === 'd1'
      ? [String(workspaceId), String(eventId), String(externalEventId || '')]
      : [String(workspaceId), String(eventId), JSON.stringify([String(externalEventId || '')])];
    const rows = authority.kind === 'd1'
      ? (await authority.binding.prepare(sql).bind(...values).all()).results || []
      : (await postgresDatabase.query(sql, values)).rows || [];
    return rows.length > 0;
  }

  async function listBrokerTpProtectionCandidates({ pageSize = 50, pageSeed = 0, observationDueBefore = null } = {}) {
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(pageSize)) || 50));
    // `pageSeed` remains part of the call contract for compatibility with
    // older runtimes, but due ordering is now the durable fairness mechanism.
    // Rotating OFFSET pages required an extra COUNT query and could repeatedly
    // skip newly-due legs when the population changed between scans.
    void pageSeed;
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    const schema = authority.kind === 'd1' ? '' : 'trading_storage.';
    // Select only due open broker-bound legs. The runtime caps this page, but
    // deliberately keeps each leg so protection edits on fast and completed
    // positions are both observable.
    // Protection snapshots must include the fast starter even when its TP is
    // still null and later completion legs already have targets. The previous
    // TP-only eligibility rule silently skipped exactly that broker position.
    const eligiblePositionPredicate = '1=1';
    const duePredicate = observationDueBefore
      ? `(l.last_broker_observed_at IS NULL OR l.last_broker_observed_at < ${authority.kind === 'd1' ? '?' : '$1'}) AND`
      : '';
    const dueValues = observationDueBefore ? [String(observationDueBefore)] : [];
    const limitParam = authority.kind === 'd1' ? '?' : `$${dueValues.length + 1}`;
    const rowsSql = `SELECT l.workspace_id, l.position_group_id, l.runtime_leg_id, l.target_index, l.logical_target_index, l.lots, l.executed_lots, l.broker_position_id, l.stop_loss, l.take_profit, l.last_broker_observed_at, l.last_broker_snapshot_fingerprint, l.created_at,
      g.runtime_group_id, g.trade_account_id, g.source_event_id, g.source_instance_id, g.source_event_ids, g.thread_id, g.canonical_symbol, g.side, g.order_type, g.entry, g.stop_loss AS group_stop_loss, g.status AS group_status, g.created_at AS group_created_at, g.updated_at AS group_updated_at
      FROM ${schema}position_legs l JOIN ${schema}position_groups g ON g.id=l.position_group_id WHERE ${duePredicate} l.status='OPEN' AND g.status='OPEN' AND l.broker_position_id IS NOT NULL AND ${eligiblePositionPredicate}
      ORDER BY CASE WHEN l.last_broker_observed_at IS NULL THEN 0 ELSE 1 END, l.last_broker_observed_at ASC, l.created_at ASC, l.id ASC LIMIT ${limitParam}`;
    let rows;
    if (authority.kind === 'd1') rows = (await authority.binding.prepare(rowsSql).bind(...dueValues, limit).all()).results || [];
    else rows = (await postgresDatabase.query(rowsSql, [...dueValues, limit])).rows || [];
    return rows.map(row => toCandidate({ ...row, position_groups: {
      runtime_group_id: row.runtime_group_id, trade_account_id: row.trade_account_id, source_event_id: row.source_event_id,
      source_instance_id: row.source_instance_id, source_event_ids: row.source_event_ids, thread_id: row.thread_id,
      canonical_symbol: row.canonical_symbol, side: row.side, order_type: row.order_type, entry: row.entry,
      stop_loss: row.group_stop_loss, created_at: row.group_created_at, updated_at: row.group_updated_at,
    } })).filter(validCandidate);
  }

  /**
   * Persist broker observation evidence without rewriting the full position
   * group. The runtime calls this only after TradeStateStore has validated the
   * observation and rejected same/older timestamps.
   */
  async function recordBrokerObservation(workspaceId, groupId, legId, observation = {}) {
    const observedAt = Number(observation.observedAt);
    const status = String(observation.status || '').trim().toUpperCase();
    if (!(Number.isFinite(observedAt) && observedAt >= 0) || !status) throw new TypeError('valid broker observation is required');
    const observedIso = new Date(observedAt).toISOString();
    const sourceVersion = observation.sourceVersion == null ? null : String(observation.sourceVersion).slice(0, 200);
    const snapshotFingerprint = observation.snapshotFingerprint == null ? null : String(observation.snapshotFingerprint).slice(0, 200);
    const dealIds = Array.isArray(observation.dealIds)
      ? [...new Set(observation.dealIds.map((id) => String(id).trim()).filter(Boolean))].slice(0, 100)
      : [];
    const patch = {
      last_broker_observed_at: observedIso,
      last_broker_source_version: sourceVersion,
      last_broker_status: status,
      last_broker_snapshot_fingerprint: snapshotFingerprint,
      ...(dealIds.length ? { broker_deal_ids: dealIds } : {}),
      ...(Object.hasOwn(observation, 'stopLoss') ? { stop_loss: observation.stopLoss == null ? null : Number(observation.stopLoss) } : {}),
      ...(Object.hasOwn(observation, 'takeProfit') ? { take_profit: observation.takeProfit == null ? null : Number(observation.takeProfit) } : {}),
    };
    for (const field of ['stop_loss', 'take_profit']) {
      if (Object.hasOwn(patch, field) && patch[field] != null && !(Number.isFinite(patch[field]) && patch[field] > 0)) {
        throw new TypeError(`broker observation ${field} must be a positive price or null`);
      }
    }
    const replicateObservation = ['TP_CONFIRMED', 'ACTIVITY_CONFIRMED', 'PROTECTION_SYNCED'].includes(status) || dealIds.length > 0
      || Object.hasOwn(observation, 'stopLoss') || Object.hasOwn(observation, 'takeProfit');
    const event = {
      authorityEpoch: authority.authorityEpoch,
      direction: authority.kind === 'd1' ? 'd1_to_postgres' : 'postgres_to_d1',
      idempotencyKey: `broker-observation:${workspaceId}:${groupId}:${legId}:${observedIso}`,
      entityType: 'trade_state_broker_observation',
      entityId: `${workspaceId}:${groupId}:${legId}`,
      operation: 'upsert',
      payload: { workspace_id: String(workspaceId), runtime_group_id: String(groupId), runtime_leg_id: String(legId), patch },
    };
    await verifyTradingStorageAuthority(authority, { postgresDatabase });
    if (authority.kind === 'd1') {
      const encodedPatch = encodeD1Row(patch);
      const columns = Object.keys(encodedPatch);
      const assignments = columns.map((column) => `${column} = ?`).join(', ');
      const update = authority.binding.prepare(`
        UPDATE position_legs SET ${assignments}
        WHERE position_group_id = (
          SELECT g.id FROM position_groups g
          WHERE g.workspace_id = ? AND g.runtime_group_id = ?
        )
          AND runtime_leg_id = ?
          AND (last_broker_observed_at IS NULL OR last_broker_observed_at < ?)
          AND EXISTS (
            SELECT 1 FROM trading_storage_control
            WHERE singleton_id = 1 AND active_authority = 'd1'
              AND authority_epoch = ? AND writes_fenced = 0
          )
      `).bind(...columns.map((column) => encodedPatch[column]), String(workspaceId), String(groupId), String(legId), observedIso, authority.authorityEpoch);
      const statements = [update];
      if (replicateObservation) {
        const journal = prepareD1ReplicationAppendStatements(authority.binding, event, {
          now: () => observedIso,
          guardSql: `EXISTS (
            SELECT 1 FROM position_legs l JOIN position_groups g ON g.id = l.position_group_id
            WHERE g.workspace_id = ? AND g.runtime_group_id = ? AND l.runtime_leg_id = ?
              AND l.last_broker_observed_at = ?
          )`,
          guardValues: [String(workspaceId), String(groupId), String(legId), observedIso],
        });
        statements.push(...journal.statements);
      }
      const results = await authority.binding.batch(statements);
      if (Number(results?.[0]?.meta?.changes || 0) !== 1) return { outcome: 'STALE' };
      if (replicateObservation && Number(results?.[2]?.meta?.changes || 0) !== 1) throw new Error('Broker observation replication journal append failed');
      return { outcome: 'APPLIED' };
    }

    return postgresDatabase.transaction(async query => {
      const authorityResult = await query(`SELECT active_authority, authority_epoch, writes_fenced FROM trading_storage.authority_control WHERE singleton_id = 1 FOR SHARE`);
      const control = authorityResult.rows?.[0];
      if (!control || control.active_authority !== 'postgres' || Number(control.authority_epoch) !== Number(authority.authorityEpoch) || control.writes_fenced !== false) {
        throw new Error('Trading storage authority changed or is fenced during broker observation update');
      }
      const values = [observedIso, sourceVersion, status, snapshotFingerprint];
      const assignments = [
        'last_broker_observed_at = $1', 'last_broker_source_version = $2',
        'last_broker_status = $3', 'last_broker_snapshot_fingerprint = $4',
      ];
      if (dealIds.length) { values.push(JSON.stringify(dealIds)); assignments.push('broker_deal_ids = $5::jsonb'); }
      const workspaceParam = values.length + 1;
      const groupParam = values.length + 2;
      const legParam = values.length + 3;
      const observedParam = values.length + 4;
      values.push(String(workspaceId), String(groupId), String(legId), observedIso);
      const updated = await query(`
        UPDATE trading_storage.position_legs l SET ${assignments.join(', ')}
        FROM trading_storage.position_groups g
        WHERE l.position_group_id = g.id AND g.workspace_id = $${workspaceParam}
          AND g.runtime_group_id = $${groupParam} AND l.runtime_leg_id = $${legParam}
          AND (l.last_broker_observed_at IS NULL OR l.last_broker_observed_at < $${observedParam})
        RETURNING l.id
      `, values);
      if (!updated.rows?.[0]?.id) return { outcome: 'STALE' };
      if (replicateObservation) await appendPostgresReplicationEventInTransaction(query, event, { now: () => new Date(observedIso) });
      return { outcome: 'APPLIED' };
    });
  }

  return { saveGroup, loadGroup, loadActive, listPendingOrderLifecycles, hasSourceEventGroup, listBrokerTpProtectionCandidates, recordBrokerObservation };
}
