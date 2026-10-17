import { assertAuthorityEpoch } from './trading_storage_authority.js';

const REQUIRED = ['authorityEpoch', 'direction', 'idempotencyKey', 'entityType', 'entityId', 'operation', 'payload'];
const DIRECTIONS = new Set(['d1_to_postgres', 'postgres_to_d1']);

export class PostgresReplicationJournal {
  constructor(database, { now = () => new Date() } = {}) {
    if (!database || typeof database.transaction !== 'function' || typeof database.query !== 'function') throw new Error('PostgreSQL replication journal requires a trading database session');
    this.database = database;
    this.now = now;
  }

  async append(input) {
    return this.database.transaction(query => appendPostgresReplicationEventInTransaction(query, input, { now: this.now }));
  }

  async readAfter({ direction, authorityEpoch, sequence = 0, limit = 100 }) {
    const epoch = assertAuthorityEpoch(authorityEpoch);
    if (!DIRECTIONS.has(direction)) throw new Error('Unsupported replication direction');
    const after = Math.max(0, Math.trunc(Number(sequence) || 0));
    const size = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
    const result = await this.database.query(`
      SELECT direction, authority_epoch AS "authorityEpoch", sequence,
             idempotency_key AS "idempotencyKey", entity_type AS "entityType",
             entity_id AS "entityId", operation, payload_json AS "payloadJson", created_at AS "createdAt"
      FROM trading_storage.replication_journal
      WHERE direction = $1 AND authority_epoch = $2 AND sequence > $3
      ORDER BY sequence ASC LIMIT $4
    `, [direction, epoch, after, size]);
    return (result.rows || []).map(row => mapRow(row, undefined));
  }
}

/** Append an event using a query function inside the caller's transaction. */
export async function appendPostgresReplicationEventInTransaction(query, input, { now = () => new Date() } = {}) {
    if (typeof query !== 'function') throw new Error('PostgreSQL transactional query function is required');
    for (const key of REQUIRED) if (input?.[key] === undefined || input?.[key] === null || input[key] === '') throw new Error(`Replication journal ${key} is required`);
    const authorityEpoch = assertAuthorityEpoch(input.authorityEpoch);
    const direction = String(input.direction);
    if (!DIRECTIONS.has(direction)) throw new Error('Unsupported replication direction');
    const values = {
      direction,
      authorityEpoch,
      idempotencyKey: String(input.idempotencyKey),
      entityType: String(input.entityType),
      entityId: String(input.entityId),
      operation: String(input.operation),
      payload: JSON.stringify(input.payload),
      createdAt: now(),
    };
    if (values.payload === undefined) throw new Error('Replication journal payload must be JSON serializable');
    if (!['upsert', 'delete'].includes(values.operation)) throw new Error('Unsupported replication operation');

      await query(`
        INSERT INTO trading_storage.replication_counters (direction, authority_epoch, last_sequence)
        VALUES ($1, $2, 0) ON CONFLICT (direction, authority_epoch) DO NOTHING
      `, [direction, authorityEpoch]);
      const counter = await query(`
        SELECT last_sequence FROM trading_storage.replication_counters
        WHERE direction = $1 AND authority_epoch = $2 FOR UPDATE
      `, [direction, authorityEpoch]);
      const existing = await query(`
        SELECT direction, authority_epoch AS "authorityEpoch", sequence,
               idempotency_key AS "idempotencyKey", entity_type AS "entityType",
               entity_id AS "entityId", operation, payload_json AS "payloadJson", created_at AS "createdAt"
        FROM trading_storage.replication_journal
        WHERE direction = $1 AND authority_epoch = $2 AND idempotency_key = $3
      `, [direction, authorityEpoch, values.idempotencyKey]);
      if (existing.rows?.[0]) {
        const row = mapRow(existing.rows[0], false);
        if (row.entityType !== values.entityType || row.entityId !== values.entityId || row.operation !== values.operation || stableJson(row.payload) !== stableJson(JSON.parse(values.payload))) {
          throw new Error('Replication idempotency key reused with a different mutation');
        }
        return row;
      }

      const sequence = Number(counter.rows?.[0]?.last_sequence) + 1;
      if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Replication counter is invalid');
      await query(`
        UPDATE trading_storage.replication_counters SET last_sequence = $3
        WHERE direction = $1 AND authority_epoch = $2
      `, [direction, authorityEpoch, sequence]);
      const inserted = await query(`
        INSERT INTO trading_storage.replication_journal (
          direction, authority_epoch, sequence, idempotency_key, entity_type,
          entity_id, operation, payload_json, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        RETURNING direction, authority_epoch AS "authorityEpoch", sequence,
                  idempotency_key AS "idempotencyKey", entity_type AS "entityType",
                  entity_id AS "entityId", operation, payload_json AS "payloadJson", created_at AS "createdAt"
      `, [direction, authorityEpoch, sequence, values.idempotencyKey, values.entityType, values.entityId,
        values.operation, values.payload, values.createdAt]);
      if (!inserted.rows?.[0]) throw new Error('PostgreSQL replication append did not persist');
      return mapRow(inserted.rows[0], true);
}

function mapRow(row, inserted) {
  const payload = typeof row.payloadJson === 'string' ? JSON.parse(row.payloadJson) : row.payloadJson;
  return { ...row, authorityEpoch: Number(row.authorityEpoch), sequence: Number(row.sequence), payload, ...(inserted === undefined ? {} : { inserted }) };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
