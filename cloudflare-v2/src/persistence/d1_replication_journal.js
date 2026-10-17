import { assertAuthorityEpoch } from './trading_storage_authority.js';

const REQUIRED = ['authorityEpoch', 'direction', 'idempotencyKey', 'entityType', 'entityId', 'operation', 'payload'];

export class D1ReplicationJournal {
  constructor(db, { now = () => new Date().toISOString() } = {}) {
    if (!db || typeof db.batch !== 'function' || typeof db.prepare !== 'function') throw new Error('D1 replication journal requires a D1 binding');
    this.db = db;
    this.now = now;
  }

  async append(input) {
    const { event, statements } = prepareD1ReplicationAppendStatements(this.db, input, { now: this.now });
    const results = await this.db.batch(statements);
    return readD1ReplicationEvent(this.db, event, Number(results?.[1]?.meta?.changes || 0) === 1);
  }

  async readAfter({ direction, authorityEpoch, sequence = 0, limit = 100 }) {
    const epoch = assertAuthorityEpoch(authorityEpoch);
    if (!['d1_to_postgres', 'postgres_to_d1'].includes(direction)) throw new Error('Unsupported replication direction');
    const size = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
    const result = await this.db.prepare(`
      SELECT direction, authority_epoch AS authorityEpoch, sequence, idempotency_key AS idempotencyKey,
             entity_type AS entityType, entity_id AS entityId, operation, payload_json AS payloadJson, created_at AS createdAt
      FROM trading_replication_journal
      WHERE direction = ? AND authority_epoch = ? AND sequence > ?
      ORDER BY sequence ASC LIMIT ?
    `).bind(direction, epoch, Math.max(0, Math.trunc(Number(sequence) || 0)), size).all();
    return (result?.results || []).map(row => ({ ...row, payload: JSON.parse(row.payloadJson) }));
  }
}

/** Build journal statements so domain writes can commit with their outbox event. */
export function prepareD1ReplicationAppendStatements(db, input, { now = () => new Date().toISOString(), guardSql = '', guardValues = [] } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('D1 replication append requires a D1 binding');
    for (const key of REQUIRED) if (input?.[key] === undefined || input?.[key] === null || input[key] === '') throw new Error(`Replication journal ${key} is required`);
    const epoch = assertAuthorityEpoch(input.authorityEpoch);
    const direction = String(input.direction);
    if (!['d1_to_postgres', 'postgres_to_d1'].includes(direction)) throw new Error('Unsupported replication direction');
    if (!['upsert', 'delete'].includes(String(input.operation))) throw new Error('Unsupported replication operation');
    const payloadJson = JSON.stringify(input.payload);
    if (payloadJson === undefined) throw new Error('Replication journal payload must be JSON serializable');
    const event = {
      authorityEpoch: epoch,
      direction,
      idempotencyKey: String(input.idempotencyKey),
      entityType: String(input.entityType),
      entityId: String(input.entityId),
      operation: String(input.operation),
      payload: payloadJson,
      createdAt: now(),
    };
    const statements = [
    // D1 batch is transactional. The counter is advanced only for a new
    // idempotency key; the journal row reads that counter in the same batch.
    // This avoids sequence holes on retries and concurrent duplicate writes.
      db.prepare(`
        INSERT INTO trading_replication_counters (direction, authority_epoch, last_sequence)
        SELECT ?, ?, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM trading_replication_journal
          WHERE direction = ? AND authority_epoch = ? AND idempotency_key = ?
        ) ${guardSql ? `AND (${guardSql})` : ''}
        ON CONFLICT(direction, authority_epoch) DO UPDATE SET last_sequence = last_sequence + 1
        WHERE NOT EXISTS (
          SELECT 1 FROM trading_replication_journal
          WHERE direction = ? AND authority_epoch = ? AND idempotency_key = ?
        ) ${guardSql ? `AND (${guardSql})` : ''}
      `).bind(direction, epoch, direction, epoch, event.idempotencyKey, ...guardValues,
        direction, epoch, event.idempotencyKey, ...guardValues),
      db.prepare(`
        INSERT INTO trading_replication_journal (
          direction, authority_epoch, sequence, idempotency_key, entity_type,
          entity_id, operation, payload_json, created_at
        )
        SELECT ?, ?, last_sequence, ?, ?, ?, ?, ?, ?
        FROM trading_replication_counters
        WHERE direction = ? AND authority_epoch = ?
          AND NOT EXISTS (
            SELECT 1 FROM trading_replication_journal
            WHERE direction = ? AND authority_epoch = ? AND idempotency_key = ?
          ) ${guardSql ? `AND (${guardSql})` : ''}
      `).bind(direction, epoch, event.idempotencyKey, event.entityType, event.entityId, event.operation, event.payload, event.createdAt,
        direction, epoch, direction, epoch, event.idempotencyKey, ...guardValues),
    ];
    return { event, statements };
}

async function readD1ReplicationEvent(db, event, inserted) {
    const row = await db.prepare(`
      SELECT direction, authority_epoch AS authorityEpoch, sequence, idempotency_key AS idempotencyKey,
             entity_type AS entityType, entity_id AS entityId, operation, payload_json AS payloadJson, created_at AS createdAt
      FROM trading_replication_journal WHERE direction = ? AND authority_epoch = ? AND idempotency_key = ?
    `).bind(event.direction, event.authorityEpoch, event.idempotencyKey).first();
    if (!row) throw new Error('Replication journal append did not persist');
    const payload = JSON.parse(row.payloadJson);
    if (row.entityType !== event.entityType || row.entityId !== event.entityId || row.operation !== event.operation || row.payloadJson !== event.payload) {
      throw new Error('Replication idempotency key reused with a different mutation');
    }
    return { ...row, payload, inserted };
}
