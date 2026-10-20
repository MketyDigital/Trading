import { assertAuthorityEpoch } from './trading_storage_authority.js';

const GROUP_COLUMNS = new Set([
  'workspace_id', 'trade_account_id', 'source_event_id', 'correlation_key', 'canonical_symbol', 'side', 'order_type',
  'entry', 'stop_loss', 'status', 'risk_plan', 'policy_snapshot', 'source_instance_id', 'source_event_ids', 'thread_id',
  'incomplete', 'position_mode', 'runtime_group_id', 'created_at', 'updated_at',
]);
const LEG_COLUMNS = new Set([
  'workspace_id', 'runtime_leg_id', 'target_index', 'lots', 'requested_lots', 'executed_lots', 'remaining_lots',
  'stop_loss', 'take_profit', 'status', 'broker_position_id', 'broker_order_id', 'broker_deal_id', 'fill_price',
  'volume_step_lots', 'minimum_lots', 'action_type', 'failure_code', 'parent_leg_id', 'lifecycle_role',
  'lifecycle_tracking_enabled', 'originating_order_id', 'logical_target_index', 'last_broker_observed_at',
  'last_broker_source_version', 'last_broker_status', 'last_broker_snapshot_fingerprint', 'broker_deal_ids',
  'opened_at', 'closed_at', 'created_at', 'updated_at',
]);
const D1_JSON_COLUMNS = new Set(['entry', 'risk_plan', 'policy_snapshot', 'source_event_ids', 'broker_deal_ids']);
const OBSERVATION_COLUMNS = new Set([
  'last_broker_observed_at', 'last_broker_source_version', 'last_broker_status',
  'last_broker_snapshot_fingerprint', 'broker_deal_ids', 'stop_loss', 'take_profit',
]);

function validateEvent(event, targetKind) {
  const targetByDirection = { d1_to_postgres: 'postgres', postgres_to_d1: 'd1' };
  if (!event || targetByDirection[event.direction] !== targetKind) throw new Error('Replication target authority does not match event direction');
  assertAuthorityEpoch(event.authorityEpoch);
  if (event.entityType !== 'trade_state_group' || event.operation !== 'upsert') throw new Error('Unsupported trading replication event');
  const group = event.payload?.group;
  const legs = event.payload?.legs;
  if (!group || !Array.isArray(legs) || !group.workspace_id || !group.runtime_group_id) throw new Error('Invalid trade-state replication payload');
  if (`${group.workspace_id}:${group.runtime_group_id}` !== event.entityId) throw new Error('Trade-state replication entity identity mismatch');
  for (const key of Object.keys(group)) if (!GROUP_COLUMNS.has(key)) throw new Error(`Unsupported trade-state group field: ${key}`);
  for (const leg of legs) {
    if (!leg || !leg.workspace_id || !leg.runtime_leg_id || !Number.isInteger(Number(leg.target_index))) throw new Error('Invalid trade-state replication leg');
    for (const key of Object.keys(leg)) if (!LEG_COLUMNS.has(key)) throw new Error(`Unsupported trade-state leg field: ${key}`);
  }
  return { group, legs };
}

function validateObservationEvent(event, targetKind) {
  const targetByDirection = { d1_to_postgres: 'postgres', postgres_to_d1: 'd1' };
  if (!event || targetByDirection[event.direction] !== targetKind) throw new Error('Replication target authority does not match event direction');
  const epoch = assertAuthorityEpoch(event.authorityEpoch);
  if (event.entityType !== 'trade_state_broker_observation' || event.operation !== 'upsert') throw new Error('Unsupported broker observation replication event');
  const payload = event.payload || {};
  if (!payload.workspace_id || !payload.runtime_group_id || !payload.runtime_leg_id || !payload.patch || typeof payload.patch !== 'object') {
    throw new Error('Invalid broker observation replication payload');
  }
  const expectedEntityId = `${payload.workspace_id}:${payload.runtime_group_id}:${payload.runtime_leg_id}`;
  if (String(event.entityId) !== expectedEntityId) throw new Error('Broker observation replication entity identity mismatch');
  const patch = {};
  for (const [key, value] of Object.entries(payload.patch)) {
    if (!OBSERVATION_COLUMNS.has(key)) throw new Error(`Unsupported broker observation field: ${key}`);
    patch[key] = value;
  }
  if (!patch.last_broker_observed_at || !patch.last_broker_status) throw new Error('Broker observation timestamp and status are required');
  return { epoch, payload: { ...payload, patch } };
}

function encodeD1(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (D1_JSON_COLUMNS.has(key) && value !== null) return [key, JSON.stringify(value)];
    if (typeof value === 'boolean') return [key, value ? 1 : 0];
    return [key, value];
  }));
}

function d1Upsert(db, table, row, id, conflict, sourceAuthority, epoch, group) {
  const encoded = encodeD1(row);
  const columns = Object.keys(encoded);
  const updates = columns.filter(key => !conflict.includes(key)).map(key => `${key} = excluded.${key}`);
  const authorityCheck = `EXISTS (SELECT 1 FROM trading_storage_control WHERE singleton_id=1 AND active_authority=? AND authority_epoch=?)`;
  const values = [id];
  let sql;
  if (table === 'position_groups') {
    sql = `INSERT INTO position_groups (id, ${columns.join(', ')}) SELECT ?, ${columns.map(() => '?').join(', ')} WHERE ${authorityCheck} ON CONFLICT(${conflict.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
    values.push(...columns.map(key => encoded[key]), sourceAuthority, epoch);
  } else {
    sql = `INSERT INTO position_legs (id, position_group_id, ${columns.join(', ')}) SELECT ?, (SELECT id FROM position_groups WHERE workspace_id=? AND runtime_group_id=?), ${columns.map(() => '?').join(', ')} WHERE ${authorityCheck} ON CONFLICT(${conflict.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
    values.push(group.workspace_id, group.runtime_group_id, ...columns.map(key => encoded[key]), sourceAuthority, epoch);
  }
  return db.prepare(sql).bind(...values);
}

function pgUpsert(table, row, conflict, groupId = null) {
  const input = table === 'position_legs' ? { ...row, position_group_id: groupId } : row;
  const columns = Object.keys(input);
  const updates = columns.filter(key => !conflict.includes(key)).map(key => `${key} = EXCLUDED.${key}`);
  return {
    sql: `INSERT INTO trading_storage.${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET ${updates.join(', ')} RETURNING id`,
    values: Object.values(input),
  };
}

export async function applyTradingTradeStateReplicationEvent(event, { targetAuthority, postgresDatabase, idFactory = () => globalThis.crypto.randomUUID() } = {}) {
  if (!targetAuthority || !['d1', 'postgres'].includes(targetAuthority.kind)) throw new TypeError('Resolved replication target authority is required');
  if (event?.entityType === 'trade_state_broker_observation') {
    const { epoch, payload } = validateObservationEvent(event, targetAuthority.kind);
    if (assertAuthorityEpoch(targetAuthority.authorityEpoch) !== epoch) throw new Error('Replication event authority epoch does not match target runtime epoch');
    const sourceAuthority = event.direction === 'd1_to_postgres' ? 'd1' : 'postgres';
    const patch = encodeD1(payload.patch);
    const columns = Object.keys(patch);
    if (targetAuthority.kind === 'd1') {
      const assignments = columns.map((column) => `${column} = ?`).join(', ');
      const result = await targetAuthority.binding.prepare(`
        UPDATE position_legs SET ${assignments}
        WHERE position_group_id = (
          SELECT g.id FROM position_groups g
          WHERE g.workspace_id = ? AND g.runtime_group_id = ?
        )
          AND runtime_leg_id = ?
          AND EXISTS (
            SELECT 1 FROM trading_storage_control
            WHERE singleton_id = 1 AND active_authority = ?
              AND authority_epoch = ?
          )
      `).bind(...columns.map((column) => patch[column]), String(payload.workspace_id), String(payload.runtime_group_id), String(payload.runtime_leg_id), sourceAuthority, epoch).run();
      if (Number(result?.meta?.changes || 0) !== 1) throw new Error('Passive D1 replica rejected broker observation');
      return { applied: true, entityId: event.entityId, observation: true };
    }
    if (!postgresDatabase) throw new TypeError('Connected PostgreSQL database is required for replication target');
    return postgresDatabase.transaction(async query => {
      const authorityResult = await query(`SELECT active_authority, authority_epoch FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);
      const persisted = authorityResult.rows?.[0];
      if (!persisted || persisted.active_authority !== sourceAuthority || Number(persisted.authority_epoch) !== epoch) {
        throw new Error('Passive PostgreSQL replica rejected stale or mismatched authority epoch');
      }
      const values = columns.map((column) => column === 'broker_deal_ids' ? JSON.stringify(patch[column]) : patch[column]);
      const assignments = columns.map((column, index) => `${column} = $${index + 1}${column === 'broker_deal_ids' ? '::jsonb' : ''}`);
      const workspaceParam = values.length + 1;
      const groupParam = values.length + 2;
      const legParam = values.length + 3;
      values.push(String(payload.workspace_id), String(payload.runtime_group_id), String(payload.runtime_leg_id));
      const updated = await query(`
        UPDATE trading_storage.position_legs l SET ${assignments.join(', ')}
        FROM trading_storage.position_groups g
        WHERE l.position_group_id = g.id AND g.workspace_id = $${workspaceParam}
          AND g.runtime_group_id = $${groupParam} AND l.runtime_leg_id = $${legParam}
        RETURNING l.id
      `, values);
      if (!updated.rows?.[0]?.id) throw new Error('Passive PostgreSQL replica rejected broker observation');
      return { applied: true, entityId: event.entityId, observation: true };
    });
  }
  const { group, legs } = validateEvent(event, targetAuthority.kind);
  const epoch = assertAuthorityEpoch(event.authorityEpoch);
  if (assertAuthorityEpoch(targetAuthority.authorityEpoch) !== epoch) throw new Error('Replication event authority epoch does not match target runtime epoch');
  const sourceAuthority = event.direction === 'd1_to_postgres' ? 'd1' : 'postgres';

  if (targetAuthority.kind === 'd1') {
    const statements = [d1Upsert(targetAuthority.binding, 'position_groups', group, idFactory(), ['workspace_id', 'runtime_group_id'], sourceAuthority, epoch)];
    for (const leg of legs) statements.push(d1Upsert(targetAuthority.binding, 'position_legs', leg, idFactory(), ['position_group_id', 'runtime_leg_id'], sourceAuthority, epoch, group));
    const results = await targetAuthority.binding.batch(statements);
    if (Number(results?.[0]?.meta?.changes || 0) !== 1) throw new Error('Passive D1 replica rejected stale or mismatched authority epoch');
    return { applied: true, entityId: event.entityId, legs: legs.length };
  }

  if (!postgresDatabase) throw new TypeError('Connected PostgreSQL database is required for replication target');
  return postgresDatabase.transaction(async query => {
    const authorityResult = await query(`SELECT active_authority, authority_epoch FROM trading_storage.authority_control WHERE singleton_id=1 FOR SHARE`);
    const persisted = authorityResult.rows?.[0];
    if (!persisted || persisted.active_authority !== sourceAuthority || Number(persisted.authority_epoch) !== epoch) {
      throw new Error('Passive PostgreSQL replica rejected stale or mismatched authority epoch');
    }
    const groupUpsert = pgUpsert('position_groups', group, ['workspace_id', 'runtime_group_id']);
    const savedGroup = await query(groupUpsert.sql, groupUpsert.values);
    const groupId = savedGroup.rows?.[0]?.id;
    if (!groupId) throw new Error('Passive PostgreSQL replica did not return the group id');
    for (const leg of legs) {
      const legUpsert = pgUpsert('position_legs', leg, ['position_group_id', 'runtime_leg_id'], groupId);
      await query(legUpsert.sql, legUpsert.values);
    }
    return { applied: true, entityId: event.entityId, legs: legs.length };
  });
}
